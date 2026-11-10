-- Per-camp connection settings that must never reach a browser (no policies = server only).
create table public.camp_secrets (
  camp_id uuid primary key references public.camps on delete cascade,
  sfsp_camp_id text,          -- the camp's ID in the SFSP app (its form link's ?c=)
  sfsp_form_url text,         -- e.g. https://www.wgcamps.com/apply.html
  sfsp_secret text,           -- shared with the SFSP app's "Roster app connection"
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.camp_secrets enable row level security;
create unique index camp_secrets_sfsp on public.camp_secrets (sfsp_camp_id) where sfsp_camp_id is not null;

-- What the staff app may know about the connection (no secret).
create or replace function public.sfsp_connection(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_role(p_camp, '{director}') then
    (select jsonb_build_object('sfsp_camp_id', s.sfsp_camp_id, 'sfsp_form_url', s.sfsp_form_url, 'has_secret', s.sfsp_secret is not null,
      'last_message', (select max(at) from public.sfsp_forms f where f.camp_id = p_camp), 'updated_at', s.updated_at)
     from public.camp_secrets s where s.camp_id = p_camp) end
$$;

create or replace function public.set_sfsp_connection(p_camp uuid, p_sfsp_camp_id text, p_form_url text, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_camp, '{director}') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_form_url is not null and p_form_url !~ '^https://' then raise exception 'The SFSP form address must start with https://'; end if;
  insert into public.camp_secrets (camp_id, sfsp_camp_id, sfsp_form_url, sfsp_secret, updated_by, updated_at)
  values (p_camp, nullif(trim(p_sfsp_camp_id), ''), nullif(trim(p_form_url), ''), nullif(trim(p_secret), ''), public.my_email(), now())
  on conflict (camp_id) do update set
    sfsp_camp_id = excluded.sfsp_camp_id, sfsp_form_url = excluded.sfsp_form_url,
    sfsp_secret = coalesce(excluded.sfsp_secret, public.camp_secrets.sfsp_secret),
    updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (camp_id, actor, action, entity, detail) values (p_camp, public.my_email(), 'update', 'sfsp_connection', jsonb_build_object('secret_changed', nullif(trim(p_secret), '') is not null));
end $$;
