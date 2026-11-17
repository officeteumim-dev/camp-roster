-- Staff: a staff application (the same machinery as camper applications, kind 'staff') and a staff roster.
-- The staff roster is everyone working at camp (lifeguards, kitchen, waiters, counselors, ...), separate from
-- the people who log in to this app (public.staff).

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  application_id uuid references public.applications on delete set null,
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null default '' check (length(last_name) <= 80),
  date_of_birth date, gender text, hebrew_name text,
  phone text, email text check (email = lower(email)),
  address text, city text, state text, zip text,
  school text, grade text,
  positions text[] not null default '{}',
  session_ids uuid[] not null default '{}',
  parents jsonb not null default '{}'::jsonb,          -- {father:{first,phone,email}, mother:{...}}
  emergency_contacts text[] not null default '{}',
  experience jsonb not null default '{}'::jsonb,       -- {camper:[{camp,years}], staff:[{camp,position,years}]}
  answers jsonb not null default '{}'::jsonb,          -- the camp's own questions: {label: answer}
  notes text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_members_camp on public.staff_members (camp_id, active);
alter table public.staff_members enable row level security;
grant select, insert, update, delete on public.staff_members to authenticated;
grant all on public.staff_members to service_role;
alter table public.applications add column staff_member_id uuid references public.staff_members on delete set null;

-- "Staff roster" in Who can see what: directors always, office by default.
create or replace function public.seed_staff_permission(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perm_items (camp_id, key, label, help, kind, sort)
  values (p_camp, 'staff_roster', 'Staff roster', 'Everyone working at camp: contacts, positions, sessions. Change: hire, add and edit staff', 'builtin', 13)
  on conflict do nothing;
  insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
  select p_camp, 'office', 'staff_roster', true, true where exists (select 1 from public.roles where camp_id = p_camp and key = 'office')
  on conflict do nothing;
end $$;
select public.seed_staff_permission(id) from public.camps;
create or replace function public.seed_staff_permission_trigger() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform public.seed_staff_permission(new.id); return new; end $$;
create trigger camps_seed_zz_staff after insert on public.camps for each row execute function public.seed_staff_permission_trigger();
grant execute on function public.seed_staff_permission(uuid) to service_role;

create policy staff_members_read on public.staff_members for select to authenticated using (public.can(camp_id, 'staff_roster', 'see'));
create policy staff_members_insert on public.staff_members for insert to authenticated with check (public.can(camp_id, 'staff_roster', 'change'));
create policy staff_members_update on public.staff_members for update to authenticated using (public.can(camp_id, 'staff_roster', 'change')) with check (public.can(camp_id, 'staff_roster', 'change'));
create policy staff_members_delete on public.staff_members for delete to authenticated using (public.is_director(camp_id));

create or replace function public.registration_info(p_slug text, p_kind text default 'camper') returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'camp_id', c.id, 'name', c.name, 'kind', p_kind,
    'open', public.registration_open(c.id, p_kind),
    'enabled', coalesce((r ->> 'enabled')::boolean, false),
    'opens_on', r ->> 'opens_on', 'closes_on', r ->> 'closes_on',
    'intro', r ->> 'intro', 'agreement', r ->> 'agreement',
    'form', coalesce(r -> 'form', '{}'::jsonb),
    'payment', coalesce(r -> 'payment', '{}'::jsonb),
    'approval', case when p_kind = 'staff' then true else coalesce((r ->> 'approval')::boolean, true) end,
    'tax_form', case when p_kind = 'staff' then coalesce(r ->> 'tax_form', 'none') end,
    'tax_when', case when p_kind = 'staff' then coalesce(r ->> 'tax_when', 'apply') end,
    'positions', case when p_kind = 'staff' then coalesce(r -> 'positions', '["Lifeguard","Canteen","Kitchen staff","Waiter","Counselor","Madrich","Leagues"]'::jsonb) end,
    'contact', c.settings ->> 'reply_to',
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.starts_on nulls last, s.name)
       from public.sessions s where s.camp_id = c.id and (r -> 'sessions' is null or r -> 'sessions' ? s.id::text)), '[]'::jsonb))
  from public.camps c, lateral (select c.settings -> 'registration' -> p_kind as r) x
  where c.slug = p_slug and p_kind in ('camper', 'staff')
$$;


create or replace function public.set_registration(p_camp uuid, p_kind text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; f jsonb; q jsonb; plans jsonb;
begin
  if not public.can(p_camp, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('camper', 'staff') then raise exception 'bad kind'; end if;
  if length(p_settings::text) > 100000 then raise exception 'Too much text'; end if;
  -- The camp's own questions: tidy, with safe ids.
  f := jsonb_build_object(
    'builtin', case when jsonb_typeof(p_settings #> '{form,builtin}') = 'object' then p_settings #> '{form,builtin}' else '{}'::jsonb end,
    'custom', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', e ->> 'id', 'section', e ->> 'section', 'label', left(trim(e ->> 'label'), 200), 'type', e ->> 'type',
        'options', case when jsonb_typeof(e -> 'options') = 'array' then e -> 'options' end,
        'required', coalesce((e ->> 'required')::boolean, false), 'help', left(nullif(trim(e ->> 'help'), ''), 500))) order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_settings #> '{form,custom}') = 'array' then p_settings #> '{form,custom}' else '[]'::jsonb end) with ordinality as t(e, n)
      where e ->> 'id' ~ '^[a-z0-9]{4,24}$' and coalesce(trim(e ->> 'label'), '') <> ''
        and e ->> 'section' in ('family', 'parents', 'emergency', 'camper', 'other', 'applicant', 'job', 'experience')
        and e ->> 'type' in ('text', 'long', 'yesno', 'choice', 'multi', 'date', 'number')), '[]'::jsonb));
  plans := coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', e ->> 'id', 'name', left(trim(e ->> 'name'), 120),
        'description', left(nullif(trim(e ->> 'description'), ''), 1000),
        'link', case when e ->> 'link' ~ '^https://[^\s<>"]+$' then left(e ->> 'link', 500) end)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_settings #> '{payment,plans}') = 'array' then p_settings #> '{payment,plans}' else '[]'::jsonb end) with ordinality as t(e, n)
      where e ->> 'id' ~ '^[a-z0-9]{4,24}$' and coalesce(trim(e ->> 'name'), '') <> ''), '[]'::jsonb);
  v := jsonb_strip_nulls(jsonb_build_object(
    'enabled', coalesce((p_settings ->> 'enabled')::boolean, false),
    'opens_on', (nullif(p_settings ->> 'opens_on', '')::date)::text,
    'closes_on', (nullif(p_settings ->> 'closes_on', '')::date)::text,
    'sessions', case when jsonb_typeof(p_settings -> 'sessions') = 'array' then p_settings -> 'sessions' end,
    'intro', left(nullif(trim(p_settings ->> 'intro'), ''), 4000),
    'agreement', left(nullif(trim(p_settings ->> 'agreement'), ''), 20000),
    'approval', case when p_kind = 'staff' then true else coalesce((p_settings ->> 'approval')::boolean, true) end,
    'positions', case when p_kind = 'staff' and jsonb_typeof(p_settings -> 'positions') = 'array' then
      (select jsonb_agg(left(trim(x), 60) order by n) from jsonb_array_elements_text(p_settings -> 'positions') with ordinality t(x, n) where trim(x) <> '') end,
    'form', f,
    'payment', jsonb_build_object('plans', plans, 'show', case when p_settings #>> '{payment,show}' = 'after_send' then 'after_send' else 'after_accept' end)));
  -- The tax form setting is saved separately (set_tax_setting); keep it.
  if p_kind = 'staff' then
    v := v || coalesce((select jsonb_strip_nulls(jsonb_build_object('tax_form', settings #>> '{registration,staff,tax_form}', 'tax_when', settings #>> '{registration,staff,tax_when}')) from public.camps where id = p_camp), '{}');
  end if;
  update public.camps set settings = jsonb_set(coalesce(settings, '{}'), '{registration}', coalesce(settings -> 'registration', '{}') || jsonb_build_object(p_kind, v)) where id = p_camp;
  -- Each camper question is a camper detail: on the Roster, in reports, in Who can see what (office and directors by default).
  if p_kind = 'camper' then
    for q in select * from jsonb_array_elements(f -> 'custom') loop
      continue when q ->> 'section' <> 'camper';
      insert into public.perm_items (camp_id, key, label, help, kind, sort)
      values (p_camp, 'f_reg_' || (q ->> 'id'), left(q ->> 'label', 80), 'Asked on the registration form', 'field', 200)
      on conflict (camp_id, key) do update set label = excluded.label;
      insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
      select p_camp, 'office', 'f_reg_' || (q ->> 'id'), true, true where exists (select 1 from public.roles where camp_id = p_camp and key = 'office')
      on conflict do nothing;
    end loop;
  end if;
  return v;
end $$;


-- Staff already on the roster who look like this applicant (returning staff).
create or replace function public.staff_application_matches(p_id uuid) returns table (member_id uuid, name text, positions text, why text)
language plpgsql stable security definer set search_path = public as $$
declare a public.applications; d jsonb; ph text;
begin
  select * into a from public.applications where id = p_id;
  if a.id is null or not public.can(a.camp_id, 'applications', 'see') then raise exception 'not allowed' using errcode = '42501'; end if;
  d := a.data; ph := right(regexp_replace(coalesce(d ->> 'phone', ''), '\D', '', 'g'), 10);
  return query
  select m.id, trim(m.first_name || ' ' || m.last_name), array_to_string(m.positions, ', '),
    concat_ws(', ', case when m.email = a.email or m.email = lower(d ->> 'email') then 'same email' end,
      case when length(ph) = 10 and right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 10) = ph then 'same phone' end,
      case when lower(m.first_name) = lower(d ->> 'first') and lower(m.last_name) = lower(d ->> 'last') then 'same name' end)
  from public.staff_members m
  where m.camp_id = a.camp_id and (m.email = a.email or m.email = lower(d ->> 'email')
    or (length(ph) = 10 and right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 10) = ph)
    or (lower(m.first_name) = lower(d ->> 'first') and lower(m.last_name) = lower(d ->> 'last')))
  limit 10;
end $$;
grant execute on function public.staff_application_matches(uuid) to authenticated;

-- Hire: a new staff member (or update a returning one) with the positions the office chose.
create or replace function public.hire_staff_application(p_id uuid, p_positions text[], p_member uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.applications; d jsonb; m uuid; form jsonb; q jsonb; ans jsonb; extra jsonb := '{}'::jsonb; sess uuid[]; emerg text[]; pos text[];
begin
  select * into a from public.applications where id = p_id for update;
  if a.id is null or not public.can(a.camp_id, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.kind <> 'staff' then raise exception 'Only staff applications can be hired.'; end if;
  if a.status not in ('submitted', 'waitlisted') then raise exception 'This application has already been decided.'; end if;
  pos := array(select distinct trim(x) from unnest(coalesce(p_positions, '{}')) x where trim(x) <> '');
  if cardinality(pos) = 0 then raise exception 'Choose at least one position.'; end if;
  d := a.data;
  select c.settings #> '{registration,staff,form}' into form from public.camps c where c.id = a.camp_id;
  for q in select * from jsonb_array_elements(coalesce(form -> 'custom', '[]')) loop
    ans := d -> 'custom' -> (q ->> 'id');
    continue when ans is null or ans = '""'::jsonb or ans = '[]'::jsonb;
    extra := extra || jsonb_build_object(q ->> 'label', case when jsonb_typeof(ans) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(ans) x) else ans #>> '{}' end);
  end loop;
  sess := array(select s.id from public.sessions s where s.camp_id = a.camp_id and s.id::text in (select jsonb_array_elements_text(coalesce(d -> 'sessions', '[]'))));
  emerg := coalesce((select array_agg(concat_ws(', ', nullif(e ->> 'name', ''), nullif(e ->> 'relation', ''), nullif(e ->> 'phone', ''))) from jsonb_array_elements(coalesce(d -> 'emergency', '[]')) e where coalesce(e ->> 'name', '') <> ''), '{}');
  if p_member is not null then
    update public.staff_members set positions = pos, session_ids = sess, application_id = a.id,
      phone = coalesce(nullif(d ->> 'phone', ''), phone), email = coalesce(lower(nullif(d ->> 'email', '')), email),
      address = coalesce(nullif(d ->> 'address', ''), address), city = coalesce(nullif(d ->> 'city', ''), city), state = coalesce(nullif(d ->> 'state', ''), state), zip = coalesce(nullif(d ->> 'zip', ''), zip),
      school = coalesce(nullif(d ->> 'school', ''), school), grade = coalesce(nullif(d ->> 'grade', ''), grade),
      parents = jsonb_build_object('father', coalesce(d -> 'father', '{}'), 'mother', coalesce(d -> 'mother', '{}')), emergency_contacts = emerg,
      experience = jsonb_build_object('camper', coalesce(d -> 'camper_experience', '[]'), 'staff', coalesce(d -> 'staff_experience', '[]')),
      answers = answers || extra, notes = coalesce(nullif(d ->> 'notes', ''), notes), active = true, updated_at = now()
    where id = p_member and camp_id = a.camp_id returning id into m;
    if m is null then raise exception 'Staff member not found'; end if;
  else
    insert into public.staff_members (camp_id, application_id, first_name, last_name, date_of_birth, gender, hebrew_name, phone, email, address, city, state, zip, school, grade,
      positions, session_ids, parents, emergency_contacts, experience, answers, notes, created_by)
    values (a.camp_id, a.id, trim(d ->> 'first'), trim(coalesce(d ->> 'last', '')), nullif(d ->> 'dob', '')::date, nullif(d ->> 'gender', ''), nullif(d ->> 'hebrew_name', ''),
      nullif(d ->> 'phone', ''), coalesce(lower(nullif(d ->> 'email', '')), a.email), nullif(d ->> 'address', ''), nullif(d ->> 'city', ''), nullif(d ->> 'state', ''), nullif(d ->> 'zip', ''),
      nullif(d ->> 'school', ''), nullif(d ->> 'grade', ''), pos, sess,
      jsonb_build_object('father', coalesce(d -> 'father', '{}'), 'mother', coalesce(d -> 'mother', '{}')), emerg,
      jsonb_build_object('camper', coalesce(d -> 'camper_experience', '[]'), 'staff', coalesce(d -> 'staff_experience', '[]')), extra, nullif(d ->> 'notes', ''), public.my_email())
    returning id into m;
  end if;
  update public.applications set status = 'accepted', staff_member_id = m, decided_by = public.my_email(), decided_at = now() where id = p_id;
  return m;
end $$;
grant execute on function public.hire_staff_application(uuid, text[], uuid) to authenticated;

-- A staff application needs the applicant's name.
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
    if new.kind = 'camper' and jsonb_array_length(coalesce(new.data -> 'campers', '[]')) = 0 then raise exception 'Please add at least one camper.'; end if;
    if new.kind = 'staff' and coalesce(trim(new.data ->> 'first'), '') = '' then raise exception 'Please fill in your name.'; end if;
    new.submitted_at := now(); new.signed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
