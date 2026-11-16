-- Who can see and change what, set by each camp's director.
-- Roles (rows): built-in and custom, each limited to the whole camp, one session or one bunk.
-- Items (columns): built-in areas of the app, plus custom camper details the director adds ("T-shirt size").
-- The database enforces the table: every security rule below reads it. The director always has full access, and staff
-- access and settings stay director-only, so a camp can't lock itself out.

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------
create table public.roles (
  camp_id uuid not null references public.camps on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(trim(label)) between 1 and 60),
  scope text not null default 'camp' check (scope in ('camp', 'session', 'bunk')),
  builtin boolean not null default false,
  sort int not null default 100,
  primary key (camp_id, key)
);

create table public.perm_items (
  camp_id uuid not null references public.camps on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(trim(label)) between 1 and 80),
  help text,
  kind text not null default 'field' check (kind in ('builtin', 'field')),
  sort int not null default 100,
  primary key (camp_id, key)
);

create table public.permissions (
  camp_id uuid not null,
  role_key text not null,
  item_key text not null,
  can_see boolean not null default false,
  can_change boolean not null default false,
  primary key (camp_id, role_key, item_key),
  foreign key (camp_id, role_key) references public.roles (camp_id, key) on delete cascade on update cascade,
  foreign key (camp_id, item_key) references public.perm_items (camp_id, key) on delete cascade
);

-- Values of custom camper details.
create table public.camper_fields (
  camper_id uuid not null references public.campers on delete cascade,
  camp_id uuid not null,
  item_key text not null,
  value text check (length(value) <= 500),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (camper_id, item_key),
  foreign key (camp_id, item_key) references public.perm_items (camp_id, key) on delete cascade
);

-- ---------------------------------------------------------------------------------------------------------------
-- Defaults: the same rules the app had before this table existed.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.seed_permissions(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.roles (camp_id, key, label, scope, builtin, sort) values
    (p_camp, 'director', 'Director', 'camp', true, 1),
    (p_camp, 'office', 'Office', 'camp', true, 2),
    (p_camp, 'finance', 'Finance', 'camp', true, 3),
    (p_camp, 'infirmary', 'Infirmary', 'camp', true, 4),
    (p_camp, 'head_counselor', 'Head counselor', 'session', true, 5),
    (p_camp, 'counselor', 'Counselor', 'bunk', true, 6)
  on conflict do nothing;
  insert into public.perm_items (camp_id, key, label, help, kind, sort) values
    (p_camp, 'roster', 'Camper list', 'Names, grades, birth dates, sessions. Change: legal and Hebrew names, staff child', 'builtin', 1),
    (p_camp, 'parent_contacts', 'Parent contacts', 'Parents'' names, phones, emails, address, emergency contacts', 'builtin', 2),
    (p_camp, 'alerts', 'Medical alerts', 'The one-line alert, e.g. "Peanut allergy, EpiPen". Change: write the alert', 'builtin', 3),
    (p_camp, 'health_forms', 'Health forms', 'Uploaded forms and medical history. Change: approve, send back, add paper forms', 'builtin', 4),
    (p_camp, 'form_status', 'Forms checklist', 'Who is missing which form. Change: send reminders, pause them, family links', 'builtin', 5),
    (p_camp, 'bunks', 'Bunks', 'Bunk lists. Change: create bunks, move campers', 'builtin', 6),
    (p_camp, 'money', 'Money', 'Charges, payments and balances', 'builtin', 7),
    (p_camp, 'imports', 'Camp Flow imports', 'Import history. Change: import a report by hand', 'builtin', 8),
    (p_camp, 'setup', 'Sessions and required forms', 'Change: add sessions and dates, turn required forms on or off', 'builtin', 9),
    (p_camp, 'activity', 'Activity log', 'Who did what, and who opened which form', 'builtin', 10)
  on conflict do nothing;
  -- role, item, see, change
  insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
  select p_camp, d.r, d.i, d.s, d.c from (values
    ('office', 'roster', true, true), ('office', 'parent_contacts', true, true), ('office', 'alerts', true, false), ('office', 'health_forms', true, false),
    ('office', 'form_status', true, true), ('office', 'bunks', true, true), ('office', 'imports', true, true), ('office', 'setup', true, true),
    ('finance', 'roster', true, false), ('finance', 'parent_contacts', true, false), ('finance', 'money', true, false),
    ('infirmary', 'roster', true, false), ('infirmary', 'parent_contacts', true, false), ('infirmary', 'alerts', true, true), ('infirmary', 'health_forms', true, true),
    ('infirmary', 'form_status', true, false), ('infirmary', 'bunks', true, false),
    ('head_counselor', 'roster', true, false), ('head_counselor', 'alerts', true, false), ('head_counselor', 'bunks', true, true),
    ('counselor', 'roster', true, false), ('counselor', 'alerts', true, false), ('counselor', 'bunks', true, false)
  ) as d(r, i, s, c)
  on conflict do nothing;
end $$;

select public.seed_permissions(id) from public.camps;

create or replace function public.seed_permissions_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.seed_permissions(new.id); return new; end $$;
create trigger camps_seed_permissions after insert on public.camps for each row execute function public.seed_permissions_trigger();

-- Staff roles become references to the camp's roles table.
alter table public.staff alter column role type text using role::text;
alter table public.staff add constraint staff_role_fk foreign key (camp_id, role) references public.roles (camp_id, key) on update cascade;

-- ---------------------------------------------------------------------------------------------------------------
-- Checks used by every rule
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.is_director(p_camp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.camp_id = p_camp and s.email = public.my_email() and s.role = 'director')
$$;

create or replace function public.perm_ok(p_camp uuid, p_role text, p_item text, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_role = 'director' or exists (select 1 from public.permissions p where p.camp_id = p_camp and p.role_key = p_role and p.item_key = p_item
    and (p.can_change or (p_mode = 'see' and p.can_see)))
$$;

-- Anywhere in the camp (ignores session and bunk limits): for pages and camp-wide lists.
create or replace function public.can(p_camp uuid, p_item text, p_mode text default 'see') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.camp_id = p_camp and s.email = public.my_email() and public.perm_ok(p_camp, s.role, p_item, p_mode))
$$;

-- For one camper: the role must have the right, and the camper must be within the person's session or bunk.
create or replace function public.can_camper(p_camper uuid, p_item text, p_mode text default 'see') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.campers c
    join public.staff s on s.camp_id = c.camp_id and s.email = public.my_email()
    join public.roles r on r.camp_id = s.camp_id and r.key = s.role
    where c.id = p_camper and public.perm_ok(c.camp_id, s.role, p_item, p_mode)
      and (s.role = 'director' or r.scope = 'camp'
        or (r.scope = 'session' and (s.session_id is null or exists (select 1 from public.enrollments e where e.camper_id = c.id and e.session_id = s.session_id)))
        or (r.scope = 'bunk' and exists (select 1 from public.bunk_assignments a where a.camper_id = c.id and a.bunk_id = s.bunk_id))))
$$;

create or replace function public.can_family(p_family uuid, p_item text, p_mode text default 'see') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campers c where c.family_id = p_family and public.can_camper(c.id, p_item, p_mode))
      or exists (select 1 from public.families f join public.staff s on s.camp_id = f.camp_id and s.email = public.my_email()
                 join public.roles r on r.camp_id = s.camp_id and r.key = s.role
                 where f.id = p_family and (s.role = 'director' or r.scope = 'camp') and public.perm_ok(f.camp_id, s.role, p_item, p_mode))
$$;

-- For one bunk: within the person's session (or their own bunk).
create or replace function public.can_bunk(p_bunk uuid, p_item text, p_mode text default 'see') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bunks b
    join public.staff s on s.camp_id = b.camp_id and s.email = public.my_email()
    join public.roles r on r.camp_id = s.camp_id and r.key = s.role
    where b.id = p_bunk and public.perm_ok(b.camp_id, s.role, p_item, p_mode)
      and (s.role = 'director' or r.scope = 'camp' or (r.scope = 'session' and (s.session_id is null or s.session_id = b.session_id)) or (r.scope = 'bunk' and s.bunk_id = b.id)))
$$;

-- For the server functions (service role): the same check for a given email.
create or replace function public.staff_can(p_camp uuid, p_email text, p_item text, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.camp_id = p_camp and s.email = lower(p_email) and public.perm_ok(p_camp, s.role, p_item, p_mode))
$$;

-- What the signed-in person may do in a camp, for the staff app to decide what to show.
create or replace function public.my_permissions(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'director', public.is_director(p_camp),
    'items', coalesce((select jsonb_object_agg(i.key, jsonb_build_object('see', public.can(p_camp, i.key, 'see'), 'change', public.can(p_camp, i.key, 'change'), 'label', i.label, 'kind', i.kind))
                       from public.perm_items i where i.camp_id = p_camp), '{}'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', s.role, 'label', r.label, 'scope', r.scope, 'session_id', s.session_id, 'bunk_id', s.bunk_id))
                       from public.staff s join public.roles r on r.camp_id = s.camp_id and r.key = s.role where s.camp_id = p_camp and s.email = public.my_email()), '[]'::jsonb))
$$;

drop function public.my_access();
create function public.my_access() returns table (camp_id uuid, camp_name text, role text, role_label text, session_id uuid, bunk_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, s.role, r.label, s.session_id, s.bunk_id from public.staff s join public.camps c on c.id = s.camp_id
  left join public.roles r on r.camp_id = s.camp_id and r.key = s.role
  where s.email = public.my_email() order by c.name, r.sort
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Rules, rewritten to read the table
-- ---------------------------------------------------------------------------------------------------------------
drop policy camps_update on public.camps;
create policy camps_update on public.camps for update to authenticated using (public.is_director(id)) with check (public.is_director(id));

drop policy sessions_write on public.sessions;
create policy sessions_write on public.sessions for all to authenticated using (public.can(camp_id, 'setup', 'change')) with check (public.can(camp_id, 'setup', 'change'));
drop policy requirements_write on public.requirements;
create policy requirements_write on public.requirements for all to authenticated using (public.can(camp_id, 'setup', 'change')) with check (public.can(camp_id, 'setup', 'change'));

drop policy staff_read on public.staff;
drop policy staff_write on public.staff;
create policy staff_read on public.staff for select to authenticated using (email = public.my_email() or public.is_director(camp_id));
create policy staff_write on public.staff for all to authenticated using (public.is_director(camp_id)) with check (public.is_director(camp_id));

drop policy families_read on public.families;
drop policy families_write on public.families;
create policy families_read on public.families for select to authenticated using (public.can_family(id, 'parent_contacts', 'see'));
create policy families_write on public.families for update to authenticated using (public.can_family(id, 'parent_contacts', 'change') or public.can_family(id, 'form_status', 'change'))
  with check (public.can_family(id, 'parent_contacts', 'change') or public.can_family(id, 'form_status', 'change'));

drop policy campers_read on public.campers;
drop policy campers_write on public.campers;
create policy campers_read on public.campers for select to authenticated using (public.can_camper(id, 'roster', 'see'));
create policy campers_write on public.campers for update to authenticated using (public.can_camper(id, 'roster', 'change')) with check (public.can_camper(id, 'roster', 'change'));

drop policy enrollments_read on public.enrollments;
drop policy enrollments_write on public.enrollments;
create policy enrollments_read on public.enrollments for select to authenticated using (public.can_camper(camper_id, 'roster', 'see'));
create policy enrollments_write on public.enrollments for all to authenticated using (public.can(camp_id, 'setup', 'change')) with check (public.can(camp_id, 'setup', 'change'));

drop policy bunks_write on public.bunks;
create policy bunks_write on public.bunks for all to authenticated using (public.can_bunk(id, 'bunks', 'change'))
  with check (exists (select 1 from public.staff s join public.roles r on r.camp_id = s.camp_id and r.key = s.role
                      where s.camp_id = bunks.camp_id and s.email = public.my_email() and public.perm_ok(s.camp_id, s.role, 'bunks', 'change')
                        and (s.role = 'director' or r.scope = 'camp' or (r.scope = 'session' and (s.session_id is null or s.session_id = bunks.session_id)))));

drop policy assignments_read on public.bunk_assignments;
drop policy assignments_write on public.bunk_assignments;
create policy assignments_read on public.bunk_assignments for select to authenticated using (public.can_bunk(bunk_id, 'bunks', 'see') and public.can_camper(camper_id, 'roster', 'see'));
create policy assignments_write on public.bunk_assignments for all to authenticated using (public.can_bunk(bunk_id, 'bunks', 'change')) with check (public.can_bunk(bunk_id, 'bunks', 'change'));

drop policy submissions_read on public.submissions;
drop policy submissions_insert on public.submissions;
drop policy submissions_update on public.submissions;
drop policy submissions_delete on public.submissions;
create policy submissions_read on public.submissions for select to authenticated
  using (case when camper_id is null then public.can_family(family_id, 'health_forms', 'see') else public.can_camper(camper_id, 'health_forms', 'see') end);
create policy submissions_insert on public.submissions for insert to authenticated
  with check (submitted_by = public.my_email() and case when camper_id is null then public.can_family(family_id, 'health_forms', 'change') else public.can_camper(camper_id, 'health_forms', 'change') end);
create policy submissions_update on public.submissions for update to authenticated
  using (case when camper_id is null then public.can_family(family_id, 'health_forms', 'change') else public.can_camper(camper_id, 'health_forms', 'change') end)
  with check (case when camper_id is null then public.can_family(family_id, 'health_forms', 'change') else public.can_camper(camper_id, 'health_forms', 'change') end);
create policy submissions_delete on public.submissions for delete to authenticated using (public.is_director(camp_id));

-- Medical details belong with the health forms; the one-line alert is shared through camper_alerts() below.
drop policy health_read on public.camper_health;
drop policy health_write on public.camper_health;
create policy health_read on public.camper_health for select to authenticated using (public.can_camper(camper_id, 'health_forms', 'see'));
create policy health_write on public.camper_health for all to authenticated using (public.can_camper(camper_id, 'alerts', 'change')) with check (public.can_camper(camper_id, 'alerts', 'change'));

drop policy sfsp_read on public.sfsp_forms;
create policy sfsp_read on public.sfsp_forms for select to authenticated using (public.can(camp_id, 'form_status', 'see'));
drop policy reminders_read on public.reminder_log;
create policy reminders_read on public.reminder_log for select to authenticated using (public.can_family(family_id, 'form_status', 'see'));

drop policy finance_accounts_read on public.finance_accounts;
drop policy finance_entries_read on public.finance_entries;
create policy finance_accounts_read on public.finance_accounts for select to authenticated using (public.can(camp_id, 'money', 'see'));
create policy finance_entries_read on public.finance_entries for select to authenticated using (public.can(camp_id, 'money', 'see'));

drop policy imports_read on public.import_runs;
create policy imports_read on public.import_runs for select to authenticated using (public.can(camp_id, 'imports', 'see'));
drop policy audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.can(camp_id, 'activity', 'see'));

alter table public.roles enable row level security;
alter table public.perm_items enable row level security;
alter table public.permissions enable row level security;
alter table public.camper_fields enable row level security;
grant select, insert, update, delete on public.roles, public.perm_items, public.permissions, public.camper_fields to authenticated;
grant all on public.roles, public.perm_items, public.permissions, public.camper_fields to service_role;
create policy roles_read on public.roles for select to authenticated using (public.is_member(camp_id));
create policy roles_write on public.roles for all to authenticated using (public.is_director(camp_id)) with check (public.is_director(camp_id));
create policy items_read on public.perm_items for select to authenticated using (public.is_member(camp_id));
create policy items_write on public.perm_items for all to authenticated using (public.is_director(camp_id)) with check (public.is_director(camp_id) and kind = 'field');
create policy permissions_read on public.permissions for select to authenticated using (public.is_member(camp_id));
create policy permissions_write on public.permissions for all to authenticated using (public.is_director(camp_id)) with check (public.is_director(camp_id));
create policy fields_read on public.camper_fields for select to authenticated using (public.can_camper(camper_id, item_key, 'see'));
create policy fields_write on public.camper_fields for all to authenticated using (public.can_camper(camper_id, item_key, 'change')) with check (public.can_camper(camper_id, item_key, 'change'));

-- Built-in roles and items can't be renamed into something else or removed in a way that breaks the app.
create or replace function public.guard_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Deleting a whole camp removes its roles; that is allowed.
  if tg_op = 'DELETE' and not exists (select 1 from public.camps c where c.id = old.camp_id) then return old; end if;
  if tg_op = 'DELETE' and old.key = 'director' then raise exception 'The Director role can''t be removed.'; end if;
  if tg_op = 'DELETE' and exists (select 1 from public.staff s where s.camp_id = old.camp_id and s.role = old.key) then
    raise exception 'Someone still has the % role. Change their role first.', old.label; end if;
  if tg_op = 'UPDATE' and (new.key <> old.key or new.camp_id <> old.camp_id) then raise exception 'A role''s key can''t change.'; end if;
  if tg_op = 'UPDATE' and old.key = 'director' and new.scope <> 'camp' then raise exception 'The Director covers the whole camp.'; end if;
  return coalesce(new, old);
end $$;
create trigger roles_guard before update or delete on public.roles for each row execute function public.guard_roles();

create or replace function public.guard_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.camps c where c.id = old.camp_id) then return old; end if;
  if tg_op = 'DELETE' and old.kind = 'builtin' then raise exception 'Built-in items can''t be removed; untick them instead.'; end if;
  if tg_op = 'UPDATE' and (new.key <> old.key or new.kind <> old.kind) then raise exception 'An item''s key can''t change.'; end if;
  return coalesce(new, old);
end $$;
create trigger items_guard before update or delete on public.perm_items for each row execute function public.guard_items();

-- The activity log skips rows of a camp that is being deleted.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; camp uuid; actor text;
begin
  r := to_jsonb(coalesce(new, old));
  camp := (r ->> 'camp_id')::uuid;
  if camp is not null and not exists (select 1 from public.camps where id = camp) then return coalesce(new, old); end if;
  actor := coalesce(public.my_email(), 'system');
  insert into public.audit_log (camp_id, actor, action, entity, entity_id, detail)
  values (camp, actor, lower(tg_op), tg_table_name, coalesce(r ->> 'id', r ->> 'camper_id', r ->> 'family_id', r ->> 'key'),
    case when tg_table_name = 'submissions' then jsonb_build_object('status', r ->> 'status', 'requirement', r ->> 'requirement_id', 'camper', r ->> 'camper_id')
         when tg_table_name = 'staff' then jsonb_build_object('email', r ->> 'email', 'role', r ->> 'role')
         when tg_table_name = 'bunk_assignments' then jsonb_build_object('bunk', r ->> 'bunk_id', 'camper', r ->> 'camper_id')
         when tg_table_name = 'permissions' then jsonb_build_object('role', r ->> 'role_key', 'item', r ->> 'item_key', 'see', r -> 'can_see', 'change', r -> 'can_change')
         when tg_table_name = 'roles' then jsonb_build_object('role', r ->> 'key', 'label', r ->> 'label', 'scope', r ->> 'scope')
         else null end);
  return coalesce(new, old);
end $$;

create trigger audit_permissions after insert or update or delete on public.permissions for each row execute function public.audit_row();
create trigger audit_roles after insert or update or delete on public.roles for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------------------------------------------
-- Functions the app calls, now reading the table
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.form_status(p_camp uuid, p_session uuid default null)
returns table (camper_id uuid, family_id uuid, first_name text, last_name text, grade text, family_name text,
               sessions text[], bunks text[], statuses jsonb, missing int, paused_until date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can(p_camp, 'form_status', 'see') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select c.id, c.family_id, c.first_name, c.last_name, c.grade, f.last_name,
    array(select s.name from public.enrollments e join public.sessions s on s.id = e.session_id where e.camper_id = c.id order by s.starts_on nulls last, s.name),
    array(select b.name from public.bunk_assignments ba join public.bunks b on b.id = ba.bunk_id where ba.camper_id = c.id order by b.name),
    st.statuses, st.missing, f.reminders_paused_until
  from public.campers c
  join public.families f on f.id = c.family_id
  cross join lateral (
    select coalesce(jsonb_object_agg(r.key, x.status), '{}'::jsonb) as statuses,
           count(*) filter (where x.status in ('missing', 'rejected'))::int as missing
    from public.requirements r
    cross join lateral (select public.status_for(r.id, c.family_id, c.id) as status) x
    where r.camp_id = p_camp and r.active
  ) st
  where c.camp_id = p_camp and c.active and f.active and public.can_camper(c.id, 'form_status', 'see')
    and (p_session is null or exists (select 1 from public.enrollments e where e.camper_id = c.id and e.session_id = p_session))
  order by f.last_name, c.first_name;
end $$;

create or replace function public.bunk_list(p_bunk uuid)
returns table (camper_id uuid, first_name text, last_name text, grade text, alert text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_bunk(p_bunk, 'bunks', 'see') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select c.id, c.first_name, c.last_name, c.grade, case when public.can_camper(c.id, 'alerts', 'see') then h.alert end
  from public.bunk_assignments ba join public.campers c on c.id = ba.camper_id
  left join public.camper_health h on h.camper_id = c.id
  where ba.bunk_id = p_bunk and c.active
  order by c.last_name, c.first_name;
end $$;

-- One-line alerts for the campers the person may see alerts for (used by the roster).
create or replace function public.camper_alerts(p_camp uuid) returns table (camper_id uuid, alert text)
language sql stable security definer set search_path = public as $$
  select h.camper_id, h.alert from public.camper_health h
  where h.camp_id = p_camp and h.alert is not null and public.can_camper(h.camper_id, 'alerts', 'see')
$$;

create or replace function public.log_file_view(p_submission uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.submissions;
begin
  select * into s from public.submissions where id = p_submission;
  if s.id is null or not (case when s.camper_id is null then public.can_family(s.family_id, 'health_forms', 'see') else public.can_camper(s.camper_id, 'health_forms', 'see') end)
  then raise exception 'not allowed'; end if;
  if not exists (select 1 from jsonb_array_elements(s.files) f where f ->> 'path' = p_path) then raise exception 'not allowed'; end if;
  insert into public.audit_log (camp_id, actor, action, entity, entity_id, detail) values (s.camp_id, public.my_email(), 'view', 'file', p_submission::text, jsonb_build_object('path', p_path));
end $$;

create or replace function public.sfsp_connection(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_director(p_camp) then
    (select jsonb_build_object('sfsp_camp_id', s.sfsp_camp_id, 'sfsp_form_url', s.sfsp_form_url, 'has_secret', s.sfsp_secret_id is not null,
      'last_message', (select max(at) from public.sfsp_forms f where f.camp_id = p_camp), 'updated_at', s.updated_at)
     from public.camp_secrets s where s.camp_id = p_camp) end
$$;

create or replace function public.set_sfsp_connection(p_camp uuid, p_sfsp_camp_id text, p_form_url text, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare cur public.camp_secrets; sec text := nullif(trim(coalesce(p_secret, '')), '');
begin
  if not public.is_director(p_camp) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_form_url is not null and trim(p_form_url) <> '' and p_form_url !~ '^https://' then raise exception 'The SFSP form address must start with https://'; end if;
  if nullif(trim(coalesce(p_sfsp_camp_id, '')), '') is not null and trim(p_sfsp_camp_id) !~ '^[A-Za-z0-9:_-]{1,100}$' then raise exception 'The SFSP camp ID can only have letters, numbers, - _ and :'; end if;
  if sec is not null and length(sec) < 32 then raise exception 'That secret looks too short. Copy the whole secret from the SFSP app.'; end if;
  select * into cur from public.camp_secrets where camp_id = p_camp;
  if cur.camp_id is null then insert into public.camp_secrets (camp_id) values (p_camp) returning * into cur; end if;
  if sec is not null then
    if cur.sfsp_secret_id is null then cur.sfsp_secret_id := vault.create_secret(sec, 'sfsp_secret_' || p_camp, 'SFSP app shared secret');
    else perform vault.update_secret(cur.sfsp_secret_id, sec); end if;
  end if;
  update public.camp_secrets set sfsp_camp_id = nullif(trim(p_sfsp_camp_id), ''), sfsp_form_url = nullif(trim(p_form_url), ''),
    sfsp_secret_id = cur.sfsp_secret_id, updated_by = public.my_email(), updated_at = now() where camp_id = p_camp;
  insert into public.audit_log (camp_id, actor, action, entity, detail) values (p_camp, public.my_email(), 'update', 'sfsp_connection', jsonb_build_object('secret_changed', sec is not null));
end $$;

-- Uploaded form files follow the table too (Health forms). Done here, before the old checks are removed.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    drop policy if exists forms_read on storage.objects;
    drop policy if exists forms_upload on storage.objects;
    drop policy if exists forms_delete on storage.objects;
    create policy forms_read on storage.objects for select to authenticated
      using (bucket_id = 'forms' and public.can(public.forms_camp(name), 'health_forms', 'see'));
    create policy forms_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'forms' and public.can(public.forms_camp(name), 'health_forms', 'change'));
    create policy forms_delete on storage.objects for delete to authenticated
      using (bucket_id = 'forms' and public.is_director(public.forms_camp(name)));
  end if;
end $$;

-- The old fixed-role checks are no longer used anywhere.
drop function public.head_counselor_camper(uuid);
drop function public.head_counselor_session(uuid, uuid);
drop function public.has_role(uuid, public.staff_role[]);
drop type public.staff_role;

revoke execute on function public.staff_can(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.staff_can(uuid, text, text, text) to service_role;
grant execute on all functions in schema public to service_role;
