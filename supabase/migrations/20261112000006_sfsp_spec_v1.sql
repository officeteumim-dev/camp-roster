-- SFSP connection spec v1: legal and Hebrew names, staff children, the age rule, the shared secret kept in Vault,
-- pre-fill and roster data, and a small rate limiter.

alter table public.campers
  add column legal_first text,
  add column legal_last text,
  add column hebrew_name text,
  add column staff_child boolean not null default false;

-- ---------- Shared secret: in Supabase Vault (encrypted at rest), never readable by the browser ----------
alter table public.camp_secrets add column sfsp_secret_id uuid;
do $$ declare r record; begin
  for r in select camp_id, sfsp_secret from public.camp_secrets where sfsp_secret is not null loop
    update public.camp_secrets set sfsp_secret_id = vault.create_secret(r.sfsp_secret, 'sfsp_secret_' || r.camp_id, 'SFSP app shared secret')
    where camp_id = r.camp_id;
  end loop;
end $$;
alter table public.camp_secrets drop column sfsp_secret;

create or replace function public.sfsp_connection(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_role(p_camp, '{director}') then
    (select jsonb_build_object('sfsp_camp_id', s.sfsp_camp_id, 'sfsp_form_url', s.sfsp_form_url, 'has_secret', s.sfsp_secret_id is not null,
      'last_message', (select max(at) from public.sfsp_forms f where f.camp_id = p_camp), 'updated_at', s.updated_at)
     from public.camp_secrets s where s.camp_id = p_camp) end
$$;

create or replace function public.set_sfsp_connection(p_camp uuid, p_sfsp_camp_id text, p_form_url text, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare cur public.camp_secrets; sec text := nullif(trim(coalesce(p_secret, '')), '');
begin
  if not public.has_role(p_camp, '{director}') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_form_url is not null and trim(p_form_url) <> '' and p_form_url !~ '^https://' then raise exception 'The SFSP form address must start with https://'; end if;
  if nullif(trim(coalesce(p_sfsp_camp_id, '')), '') is not null and trim(p_sfsp_camp_id) !~ '^[A-Za-z0-9:_-]{1,100}$' then raise exception 'The SFSP camp ID can only have letters, numbers, - _ and :'; end if;
  if sec is not null and length(sec) < 32 then raise exception 'That secret looks too short. Copy the whole secret from the SFSP app.'; end if;
  select * into cur from public.camp_secrets where camp_id = p_camp;
  if cur.camp_id is null then
    insert into public.camp_secrets (camp_id) values (p_camp) returning * into cur;
  end if;
  if sec is not null then
    if cur.sfsp_secret_id is null then
      cur.sfsp_secret_id := vault.create_secret(sec, 'sfsp_secret_' || p_camp, 'SFSP app shared secret');
    else
      perform vault.update_secret(cur.sfsp_secret_id, sec);
    end if;
  end if;
  update public.camp_secrets set sfsp_camp_id = nullif(trim(p_sfsp_camp_id), ''), sfsp_form_url = nullif(trim(p_form_url), ''),
    sfsp_secret_id = cur.sfsp_secret_id, updated_by = public.my_email(), updated_at = now() where camp_id = p_camp;
  insert into public.audit_log (camp_id, actor, action, entity, detail) values (p_camp, public.my_email(), 'update', 'sfsp_connection', jsonb_build_object('secret_changed', sec is not null));
end $$;

-- Server only: the connection for a camp (by our camp ID or by the SFSP app's camp ID), with the secret.
create or replace function public.sfsp_secret_for(p_camp uuid default null, p_sfsp_camp_id text default null)
returns table (camp_id uuid, sfsp_camp_id text, sfsp_form_url text, secret text)
language sql stable security definer set search_path = public, vault as $$
  select s.camp_id, s.sfsp_camp_id, s.sfsp_form_url, v.decrypted_secret
  from public.camp_secrets s left join vault.decrypted_secrets v on v.id = s.sfsp_secret_id
  where (p_camp is not null and s.camp_id = p_camp) or (p_sfsp_camp_id is not null and s.sfsp_camp_id = p_sfsp_camp_id)
  limit 1
$$;

-- ---------- Age rule (spec section 9) ----------
-- A child 19 or older on the first day of their session isn't eligible. A family whose children at camp are ALL too old
-- doesn't need the SFSP form. Missing birth date or session dates = assume eligible.
create or replace function public.sfsp_too_old(p_camper uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.date_of_birth is not null and min(s.starts_on) is not null and age(min(s.starts_on), c.date_of_birth) >= interval '19 years'
    from public.campers c left join public.enrollments e on e.camper_id = c.id left join public.sessions s on s.id = e.session_id
    where c.id = p_camper group by c.date_of_birth), false)
$$;

create or replace function public.sfsp_needed(p_family uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.campers c where c.family_id = p_family and c.active)
      or exists (select 1 from public.campers c where c.family_id = p_family and c.active and not public.sfsp_too_old(c.id))
$$;

create or replace function public.status_for(p_req uuid, p_family uuid, p_camper uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when r.kind = 'sfsp' then
      case when exists (select 1 from public.sfsp_forms x join public.families f on f.id = p_family
                        where x.camp_id = r.camp_id and x.household = f.external_id and x.state = 'received') then 'received'
           when not public.sfsp_needed(p_family) then 'not_needed'
           else 'missing' end
    else coalesce(
      (select 'approved' from public.families f where f.id = p_family and r.kind = 'consent'
         and nullif(r.config ->> 'accept_disclosure', '') is not null
         and lower(coalesce(f.disclosures ->> (r.config ->> 'accept_disclosure'), '')) = 'yes'),
      (select s.status from public.submissions s
         where s.requirement_id = r.id and s.family_id = p_family
           and (case when r.scope = 'camper' then s.camper_id = p_camper else s.camper_id is null end)
         order by s.created_at desc limit 1),
      'missing')
  end
  from public.requirements r where r.id = p_req
$$;

-- ---------- Pre-fill and roster (spec sections 5 and 7). IDs: household = families.external_id, child and session = our IDs ----------
create or replace function public.sfsp_child_json(c public.campers) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id::text,
    'legalFirst', coalesce(nullif(c.legal_first, ''), c.first_name, ''),
    'legalLast', coalesce(nullif(c.legal_last, ''), nullif(c.last_name, ''), ''),
    'hebrewName', coalesce(c.hebrew_name, ''),
    'dob', coalesce(to_char(c.date_of_birth, 'YYYY-MM-DD'), ''),
    'sessions', coalesce((select jsonb_agg(e.session_id::text order by e.session_id) from public.enrollments e where e.camper_id = c.id), '[]'::jsonb))
$$;

create or replace function public.sfsp_prefill(p_camp uuid, p_household text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'household', f.external_id,
    'parent', jsonb_build_object(
      'firstName', coalesce(case when f.mother_first is not null and (f.mother_phone is not null or f.mother_email is not null) and f.father_phone is null and f.father_email is null then f.mother_first else coalesce(f.father_first, f.mother_first) end, ''),
      'lastName', coalesce(f.last_name, ''),
      'phone', coalesce(regexp_replace(coalesce(f.father_phone, f.mother_phone, ''), '\D', '', 'g'), ''),
      'email', coalesce(f.father_email, f.mother_email, ''),
      'address', jsonb_build_object('street', coalesce(f.address, ''), 'apt', '', 'city', coalesce(f.city, ''), 'state', coalesce(f.state, ''), 'zip', coalesce(f.zip, ''))),
    'children', coalesce((select jsonb_agg(public.sfsp_child_json(c) order by c.date_of_birth nulls last, c.first_name)
                          from public.campers c where c.family_id = f.id and c.active), '[]'::jsonb))
  from public.families f where f.camp_id = p_camp and f.external_id = p_household and f.active
$$;

create or replace function public.sfsp_roster(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'camp', (select sfsp_camp_id from public.camp_secrets where camp_id = p_camp),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name,
                  'start', coalesce(to_char(s.starts_on, 'YYYY-MM-DD'), ''), 'end', coalesce(to_char(s.ends_on, 'YYYY-MM-DD'), '')) order by s.starts_on nulls last, s.name)
                  from public.sessions s where s.camp_id = p_camp), '[]'::jsonb),
    'households', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.external_id, 'lastName', coalesce(f.last_name, ''),
        'phone', coalesce(regexp_replace(coalesce(f.father_phone, f.mother_phone, ''), '\D', '', 'g'), ''), 'zip', coalesce(f.zip, ''),
        'children', (select jsonb_agg(public.sfsp_child_json(c) || jsonb_build_object('staffChild', c.staff_child) order by c.first_name)
                     from public.campers c where c.family_id = f.id and c.active)) order by f.last_name)
      from public.families f where f.camp_id = p_camp and f.active
        and exists (select 1 from public.campers c where c.family_id = f.id and c.active)), '[]'::jsonb))
$$;

-- ---------- Rate limit (fixed window per key) ----------
create table public.rate_hits (key text not null, window_start timestamptz not null, hits int not null default 0, primary key (key, window_start));
alter table public.rate_hits enable row level security;
create or replace function public.rate_ok(p_key text, p_limit int, p_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds); n int;
begin
  insert into public.rate_hits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = public.rate_hits.hits + 1 returning hits into n;
  if random() < 0.01 then delete from public.rate_hits where window_start < now() - interval '1 hour'; end if;
  return n <= p_limit;
end $$;

-- Server only.
revoke execute on function public.sfsp_secret_for(uuid, text) from public, anon, authenticated;
revoke execute on function public.sfsp_prefill(uuid, text) from public, anon, authenticated;
revoke execute on function public.sfsp_roster(uuid) from public, anon, authenticated;
revoke execute on function public.sfsp_child_json(public.campers) from public, anon, authenticated;
revoke execute on function public.rate_ok(text, int, int) from public, anon, authenticated;
revoke execute on function public.status_for(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.sfsp_secret_for(uuid, text), public.sfsp_prefill(uuid, text), public.sfsp_roster(uuid),
  public.sfsp_child_json(public.campers), public.rate_ok(text, int, int), public.status_for(uuid, uuid, uuid),
  public.sfsp_too_old(uuid), public.sfsp_needed(uuid) to service_role;
grant all on public.rate_hits to service_role;
