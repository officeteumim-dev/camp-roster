-- Online registration (off until a director turns it on). Parents fill in an application on the registration page;
-- the office accepts it into the roster (as a new family, or into a family that's already there from Camp Flow),
-- waitlists or declines it. Built for camper applications now and staff applications next (kind).

-- Where a family came from. Camp Flow families keep 'campflow:<id>'; online ones get 'online:<application id>'.
-- The Camp Flow import only ever looks at 'campflow:' families, so it never flags online families as gone.

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  kind text not null default 'camper' check (kind in ('camper', 'staff')),
  user_id uuid not null default auth.uid(),
  email text not null default public.my_email() check (email = lower(email)),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'accepted', 'waitlisted', 'declined', 'withdrawn')),
  data jsonb not null default '{}'::jsonb check (length(data::text) < 60000),
  signature text check (length(signature) <= 200),
  signed_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  office_note text,
  family_id uuid references public.families on delete set null,
  confirmation_sent_at timestamptz,   -- parent emailed "we received it"
  emailed_status text,                -- the last decision the parent was emailed about
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index applications_camp on public.applications (camp_id, kind, status);
-- One open application per person, camp and kind (a family's application lists all its children).
create unique index applications_one_open on public.applications (camp_id, kind, email) where status in ('draft', 'submitted', 'waitlisted');
alter table public.applications enable row level security;
grant select, insert, update on public.applications to authenticated;
grant all on public.applications to service_role;

-- Is online registration open for this camp right now?
create or replace function public.registration_open(p_camp uuid, p_kind text default 'camper') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((c.settings -> 'registration' -> p_kind ->> 'enabled')::boolean, false)
     and (nullif(c.settings -> 'registration' -> p_kind ->> 'opens_on', '') is null or (now() at time zone c.timezone)::date >= (c.settings -> 'registration' -> p_kind ->> 'opens_on')::date)
     and (nullif(c.settings -> 'registration' -> p_kind ->> 'closes_on', '') is null or (now() at time zone c.timezone)::date <= (c.settings -> 'registration' -> p_kind ->> 'closes_on')::date)
  from public.camps c where c.id = p_camp
$$;

-- Applicants: see their own; write only while it's a draft (and only to submit it, never to decide it).
create policy app_own_read on public.applications for select to authenticated using (user_id = auth.uid());
create policy app_own_insert on public.applications for insert to authenticated
  with check (user_id = auth.uid() and email = public.my_email() and status = 'draft' and public.registration_open(camp_id, kind)
              and decided_by is null and family_id is null and office_note is null and confirmation_sent_at is null and emailed_status is null);
create policy app_own_update on public.applications for update to authenticated
  using (user_id = auth.uid() and status = 'draft')
  with check (user_id = auth.uid() and status in ('draft', 'submitted') and public.registration_open(camp_id, kind)
              and decided_by is null and family_id is null and office_note is null and confirmation_sent_at is null and emailed_status is null);
-- The office: everything for its camp ("Applications" in Who can see what).
create policy app_staff_read on public.applications for select to authenticated using (public.can(camp_id, 'applications', 'see'));
create policy app_staff_update on public.applications for update to authenticated using (public.can(camp_id, 'applications', 'change')) with check (public.can(camp_id, 'applications', 'change'));

-- Applicants can't change who they are, what camp it's for, or decision fields; submitting stamps the time.
-- (Runs as the caller, so current_user is who is really making the change.)
create or replace function public.applications_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.can(old.camp_id, 'applications', 'change') or current_user in ('service_role', 'postgres') then
    new.updated_at := now(); return new;
  end if;
  if new.camp_id <> old.camp_id or new.kind <> old.kind or new.user_id <> old.user_id or new.email <> old.email then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new.status = 'submitted' and old.status = 'draft' then
    if coalesce(trim(new.signature), '') = '' then raise exception 'Please sign the application.'; end if;
    if jsonb_array_length(coalesce(new.data -> 'campers', '[]')) = 0 and new.kind = 'camper' then raise exception 'Please add at least one camper.'; end if;
    new.submitted_at := now(); new.signed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger applications_guard before update on public.applications for each row execute function public.applications_guard();

-- The "Applications" row in Who can see what: directors always, office by default.
create or replace function public.seed_applications_permission(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perm_items (camp_id, key, label, help, kind, sort)
  values (p_camp, 'applications', 'Applications', 'Online applications. Change: accept, waitlist or decline them, and set up online registration', 'builtin', 12)
  on conflict do nothing;
  insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
  select p_camp, 'office', 'applications', true, true where exists (select 1 from public.roles where camp_id = p_camp and key = 'office')
  on conflict do nothing;
end $$;
select public.seed_applications_permission(id) from public.camps;
create or replace function public.seed_applications_permission_trigger() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform public.seed_applications_permission(new.id); return new; end $$;
-- (Triggers run in name order: this must come after camps_seed_permissions, which makes the roles.)
create trigger camps_seed_zz_applications after insert on public.camps for each row execute function public.seed_applications_permission_trigger();
grant execute on function public.seed_applications_permission(uuid) to service_role;

-- What the public registration page shows. Anyone may call it (no personal data).
create or replace function public.registration_info(p_slug text, p_kind text default 'camper') returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'camp_id', c.id, 'name', c.name, 'kind', p_kind,
    'open', public.registration_open(c.id, p_kind),
    'enabled', coalesce((c.settings -> 'registration' -> p_kind ->> 'enabled')::boolean, false),
    'opens_on', c.settings -> 'registration' -> p_kind ->> 'opens_on',
    'closes_on', c.settings -> 'registration' -> p_kind ->> 'closes_on',
    'intro', c.settings -> 'registration' -> p_kind ->> 'intro',
    'agreement', c.settings -> 'registration' -> p_kind ->> 'agreement',
    'contact', c.settings ->> 'reply_to',
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.starts_on nulls last, s.name)
       from public.sessions s where s.camp_id = c.id
         and (c.settings -> 'registration' -> p_kind -> 'sessions' is null or c.settings -> 'registration' -> p_kind -> 'sessions' ? s.id::text)), '[]'::jsonb))
  from public.camps c where c.slug = p_slug and p_kind in ('camper', 'staff')
$$;
grant execute on function public.registration_info(text, text) to anon, authenticated;

-- Families already in the roster that look like this application's family (same email or phone, or same last name and father).
create or replace function public.application_matches(p_id uuid) returns table (family_id uuid, last_name text, parents text, source text, campers text, why text)
language plpgsql stable security definer set search_path = public as $$
declare a public.applications; d jsonb; emails text[]; phones text[];
begin
  select * into a from public.applications where id = p_id;
  if a.id is null or not public.can(a.camp_id, 'applications', 'see') then raise exception 'not allowed' using errcode = '42501'; end if;
  d := a.data;
  emails := array_remove(array[lower(d #>> '{father,email}'), lower(d #>> '{mother,email}'), a.email], null);
  phones := array_remove(array[right(regexp_replace(d #>> '{father,phone}', '\D', '', 'g'), 10), right(regexp_replace(d #>> '{mother,phone}', '\D', '', 'g'), 10)], '');
  return query
  select f.id, f.last_name, concat_ws(' & ', f.father_first, f.mother_first), case when f.external_id like 'campflow:%' then 'Camp Flow' else 'Online' end,
    (select string_agg(c.first_name, ', ' order by c.first_name) from public.campers c where c.family_id = f.id and c.active),
    concat_ws(', ',
      case when lower(f.father_email) = any(emails) or lower(f.mother_email) = any(emails) then 'same email' end,
      case when right(regexp_replace(coalesce(f.father_phone, ''), '\D', '', 'g'), 10) = any(phones) or right(regexp_replace(coalesce(f.mother_phone, ''), '\D', '', 'g'), 10) = any(phones) then 'same phone' end,
      case when lower(f.last_name) = lower(d ->> 'last_name') and lower(coalesce(f.father_first, '')) = lower(coalesce(d #>> '{father,first}', '-')) then 'same name' end)
  from public.families f
  where f.camp_id = a.camp_id and f.active
    and (lower(f.father_email) = any(emails) or lower(f.mother_email) = any(emails)
      or right(regexp_replace(coalesce(f.father_phone, ''), '\D', '', 'g'), 10) = any(phones) and length(right(regexp_replace(coalesce(f.father_phone, ''), '\D', '', 'g'), 10)) = 10
      or right(regexp_replace(coalesce(f.mother_phone, ''), '\D', '', 'g'), 10) = any(phones) and length(right(regexp_replace(coalesce(f.mother_phone, ''), '\D', '', 'g'), 10)) = 10
      or (lower(f.last_name) = lower(d ->> 'last_name') and lower(coalesce(f.father_first, '')) = lower(coalesce(d #>> '{father,first}', '-'))))
  limit 10;
end $$;
grant execute on function public.application_matches(uuid) to authenticated;

-- Accept a camper application: a new family (p_family null) or more campers in an existing one.
-- Existing families' details are not overwritten (Camp Flow's report stays the source for Camp Flow families).
create or replace function public.accept_application(p_id uuid, p_family uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.applications; d jsonb; fam uuid; k jsonb; cid uuid; sid text;
begin
  select * into a from public.applications where id = p_id for update;
  if a.id is null or not public.can(a.camp_id, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.kind <> 'camper' then raise exception 'Only camper applications can be added to the roster.'; end if;
  if a.status not in ('submitted', 'waitlisted') then raise exception 'This application has already been decided.'; end if;
  d := a.data;
  if p_family is not null then
    select id into fam from public.families where id = p_family and camp_id = a.camp_id;
    if fam is null then raise exception 'Family not found'; end if;
  else
    insert into public.families (camp_id, external_id, last_name, father_title, father_first, father_phone, father_email, father_occupation,
      mother_title, mother_first, mother_phone, mother_email, mother_occupation, maiden_name, address, city, state, zip, emergency_contacts, applied_at)
    values (a.camp_id, 'online:' || a.id, trim(coalesce(d ->> 'last_name', '')),
      nullif(d #>> '{father,title}', ''), nullif(d #>> '{father,first}', ''), nullif(d #>> '{father,phone}', ''), lower(nullif(d #>> '{father,email}', '')), nullif(d #>> '{father,occupation}', ''),
      nullif(d #>> '{mother,title}', ''), nullif(d #>> '{mother,first}', ''), nullif(d #>> '{mother,phone}', ''), lower(nullif(d #>> '{mother,email}', '')), nullif(d #>> '{mother,occupation}', ''),
      nullif(d #>> '{mother,maiden}', ''), nullif(d ->> 'address', ''), nullif(d ->> 'city', ''), nullif(d ->> 'state', ''), nullif(d ->> 'zip', ''),
      coalesce((select array_agg(concat_ws(', ', nullif(e ->> 'name', ''), nullif(e ->> 'relation', ''), nullif(e ->> 'phone', ''))) from jsonb_array_elements(coalesce(d -> 'emergency', '[]')) e where coalesce(e ->> 'name', '') <> ''), '{}'),
      a.submitted_at)
    returning id into fam;
  end if;
  for k in select * from jsonb_array_elements(coalesce(d -> 'campers', '[]')) loop
    insert into public.campers (camp_id, family_id, first_name, last_name, date_of_birth, gender, grade, legal_first, legal_last, hebrew_name)
    values (a.camp_id, fam, trim(k ->> 'first'), coalesce(nullif(trim(k ->> 'last'), ''), trim(coalesce(d ->> 'last_name', ''))),
      nullif(k ->> 'dob', '')::date, nullif(k ->> 'gender', ''), nullif(k ->> 'grade', ''), nullif(k ->> 'legal_first', ''), nullif(k ->> 'legal_last', ''), nullif(k ->> 'hebrew_name', ''))
    returning id into cid;
    for sid in select jsonb_array_elements_text(coalesce(k -> 'sessions', '[]')) loop
      insert into public.enrollments (camper_id, session_id, camp_id)
      select cid, s.id, a.camp_id from public.sessions s where s.id::text = sid and s.camp_id = a.camp_id on conflict do nothing;
    end loop;
  end loop;
  update public.applications set status = 'accepted', family_id = fam, decided_by = public.my_email(), decided_at = now() where id = p_id;
  return fam;
end $$;
grant execute on function public.accept_application(uuid, uuid) to authenticated;

-- Registration settings (on/off, dates, sessions, intro, agreement), changed by whoever may change Applications.
create or replace function public.set_registration(p_camp uuid, p_kind text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.can(p_camp, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('camper', 'staff') then raise exception 'bad kind'; end if;
  v := jsonb_strip_nulls(jsonb_build_object(
    'enabled', coalesce((p_settings ->> 'enabled')::boolean, false),
    'opens_on', (nullif(p_settings ->> 'opens_on', '')::date)::text,
    'closes_on', (nullif(p_settings ->> 'closes_on', '')::date)::text,
    'sessions', case when jsonb_typeof(p_settings -> 'sessions') = 'array' then p_settings -> 'sessions' end,
    'intro', left(nullif(trim(p_settings ->> 'intro'), ''), 4000),
    'agreement', left(nullif(trim(p_settings ->> 'agreement'), ''), 20000)));
  update public.camps set settings = jsonb_set(coalesce(settings, '{}'), '{registration}', coalesce(settings -> 'registration', '{}') || jsonb_build_object(p_kind, v)) where id = p_camp;
  return v;
end $$;
grant execute on function public.set_registration(uuid, text, jsonb) to authenticated;
