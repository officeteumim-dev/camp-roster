-- Camp roster app: core schema, roles and row-level security.
-- Every table carries camp_id so several camps can share one installation; each camp's records are private to its staff.
-- Families and campers keep the external ID they were imported with (for now "campflow:<number>"), so the app can
-- later issue its own IDs without changing anything else.

-- ---------------------------------------------------------------------------------------------------------------
-- Camps and staff
-- ---------------------------------------------------------------------------------------------------------------
create table public.camps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  timezone text not null default 'America/New_York',
  -- Plain settings: forms deadline, reply-to address, email sender name, reminder schedule, SFSP form base URL.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create type public.staff_role as enum ('director', 'office', 'finance', 'infirmary', 'head_counselor', 'counselor');

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  name text not null,
  external_name text,             -- the session's name as it appears in Camp Flow reports
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (camp_id, name)
);

create table public.bunks (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  session_id uuid not null references public.sessions on delete cascade,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, name)
);

-- One row per person per role. session_id narrows a head counselor (or counselor) to one session;
-- bunk_id is the counselor's bunk.
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  name text,
  role public.staff_role not null,
  session_id uuid references public.sessions on delete cascade,
  bunk_id uuid references public.bunks on delete set null,
  added_by text,
  created_at timestamptz not null default now()
);
create unique index staff_unique on public.staff (camp_id, email, role, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(bunk_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index staff_email on public.staff (email);

-- ---------------------------------------------------------------------------------------------------------------
-- Families, campers, enrollment
-- ---------------------------------------------------------------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  external_id text not null,            -- 'campflow:12345'
  last_name text not null default '',
  father_title text, father_first text, father_phone text, father_email text, father_occupation text,
  mother_title text, mother_first text, mother_phone text, mother_email text, mother_occupation text,
  maiden_name text, marital_status text,
  address text, city text, state text, zip text,
  affiliation text,
  emergency_contacts text[] not null default '{}',
  disclosures jsonb not null default '{}'::jsonb,   -- {"Medical Authorization": "Yes", ...}
  applied_at timestamptz,
  active boolean not null default true,  -- false = no longer in the latest Camp Flow report (flagged, not deleted)
  missing_since timestamptz,
  reminders_paused_until date,
  reminder_note text,
  welcome_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (camp_id, external_id)
);

create table public.campers (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  external_id text,                     -- 'campflow:camper:678' when the camper report provides one
  first_name text not null,
  last_name text not null default '',
  date_of_birth date,
  gender text,
  grade text,
  derived boolean not null default false,  -- true = known only from the families report's "Camper names"
  active boolean not null default true,
  missing_since timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index campers_external on public.campers (camp_id, external_id) where external_id is not null;
create index campers_family on public.campers (family_id);

create table public.enrollments (
  camper_id uuid not null references public.campers on delete cascade,
  session_id uuid not null references public.sessions on delete cascade,
  camp_id uuid not null references public.camps on delete cascade,
  primary key (camper_id, session_id)
);

create table public.bunk_assignments (
  bunk_id uuid not null references public.bunks on delete cascade,
  camper_id uuid not null references public.campers on delete cascade,
  camp_id uuid not null references public.camps on delete cascade,
  assigned_by text,
  assigned_at timestamptz not null default now(),
  primary key (bunk_id, camper_id)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Required forms
-- ---------------------------------------------------------------------------------------------------------------
-- kind:  sfsp          = checked off by the SFSP app ("received" per household)
--        upload        = files the family (or infirmary) uploads; config.fields adds typed fields (e.g. insurance)
--        consent       = signed in the portal; config.accept_disclosure names a Camp Flow disclosure that also counts
--        questionnaire = medical history; answering "no allergies, conditions or medications" makes it not needed
create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null,
  help text,
  scope text not null check (scope in ('family', 'camper')),
  kind text not null check (kind in ('sfsp', 'upload', 'consent', 'questionnaire')),
  health boolean not null default true,  -- health records: only director, office (view) and infirmary see the contents
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort int not null default 0,
  unique (camp_id, key)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  requirement_id uuid not null references public.requirements on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  camper_id uuid references public.campers on delete cascade,   -- null for family-scope requirements
  status text not null check (status in ('received', 'approved', 'rejected', 'not_needed')),
  files jsonb not null default '[]'::jsonb,    -- [{path, name, type, size}] in the private "forms" bucket
  answers jsonb not null default '{}'::jsonb,
  submitted_by text not null,                 -- 'family' or a staff email
  reject_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index submissions_lookup on public.submissions (requirement_id, family_id, camper_id, created_at desc);

-- What counselors may see: a short alert written or approved by the infirmary ("Peanut allergy, EpiPen").
create table public.camper_health (
  camper_id uuid primary key references public.campers on delete cascade,
  camp_id uuid not null references public.camps on delete cascade,
  alert text,
  allergies text,
  conditions text,
  medications text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- From the SFSP app: one row per SFSP form, with no content.
create table public.sfsp_forms (
  camp_id uuid not null references public.camps on delete cascade,
  form_id text not null,
  household text not null,
  state text not null check (state in ('received', 'removed')),
  at timestamptz not null default now(),
  primary key (camp_id, form_id)
);
create index sfsp_household on public.sfsp_forms (camp_id, household);

-- Family links: only the SHA-256 of the token is stored.
create table public.family_links (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index family_links_family on public.family_links (family_id);

create table public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  kind text not null check (kind in ('welcome', 'reminder', 'manual', 'rejected')),
  sent_to text[] not null,
  missing jsonb not null default '[]'::jsonb,
  provider_id text,
  error text,
  sent_by text,
  sent_at timestamptz not null default now()
);
create index reminder_log_family on public.reminder_log (family_id, sent_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Money (read-only copy of Camp Flow this season; the ledger the app will write itself after the switchover)
-- ---------------------------------------------------------------------------------------------------------------
create table public.finance_accounts (
  family_id uuid primary key references public.families on delete cascade,
  camp_id uuid not null references public.camps on delete cascade,
  total_charges_cents bigint,
  total_payments_cents bigint,
  balance_cents bigint,
  pending_payments_cents bigint,
  upcoming_autopay text,
  balance_after_expected_cents bigint,
  payment_methods int,
  active_autopay text,
  paused_autopay text,
  source text not null default 'campflow',
  as_of timestamptz not null default now()
);

-- Entries are never edited: a correction is a new entry.
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  family_id uuid not null references public.families on delete cascade,
  external_id text,                     -- the source system's transaction id, when there is one
  occurred_on date not null,
  kind text not null check (kind in ('charge', 'payment', 'refund', 'discount', 'adjustment')),
  description text,
  amount_cents bigint not null,         -- positive; kind says which way it moves the balance
  source text not null default 'campflow',
  created_at timestamptz not null default now()
);
alter table public.finance_entries add constraint finance_entries_external unique (camp_id, source, external_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Imports and activity
-- ---------------------------------------------------------------------------------------------------------------
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  report text not null,                 -- 'families', 'campers', 'transactions'
  file_name text,
  via text not null,                    -- 'email' or a staff email
  counts jsonb not null default '{}'::jsonb,
  problems jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  camp_id uuid references public.camps on delete cascade,
  actor text,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);
create index audit_camp on public.audit_log (camp_id, at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.my_email() returns text
language sql stable as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

create or replace function public.has_role(p_camp uuid, p_roles public.staff_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.camp_id = p_camp and s.email = public.my_email() and s.role = any (p_roles))
$$;

create or replace function public.is_member(p_camp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.camp_id = p_camp and s.email = public.my_email())
$$;

-- Head counselors: all sessions when not narrowed, else the sessions they were given.
create or replace function public.head_counselor_session(p_camp uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.camp_id = p_camp and s.email = public.my_email()
    and s.role = 'head_counselor' and (s.session_id is null or s.session_id = p_session))
$$;

create or replace function public.head_counselor_camper(p_camper uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.camper_id = p_camper
    and public.head_counselor_session(e.camp_id, e.session_id))
$$;

-- The camps the signed-in person works for, with their roles (used by the staff app on sign-in).
create or replace function public.my_access() returns table (camp_id uuid, camp_name text, role public.staff_role, session_id uuid, bunk_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, s.role, s.session_id, s.bunk_id from public.staff s join public.camps c on c.id = s.camp_id
  where s.email = public.my_email() order by c.name, s.role
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Row-level security. The service role (server functions) bypasses all of this.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.camps enable row level security;
alter table public.sessions enable row level security;
alter table public.bunks enable row level security;
alter table public.staff enable row level security;
alter table public.families enable row level security;
alter table public.campers enable row level security;
alter table public.enrollments enable row level security;
alter table public.bunk_assignments enable row level security;
alter table public.requirements enable row level security;
alter table public.submissions enable row level security;
alter table public.camper_health enable row level security;
alter table public.sfsp_forms enable row level security;
alter table public.family_links enable row level security;
alter table public.reminder_log enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_entries enable row level security;
alter table public.import_runs enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Camps
create policy camps_read on public.camps for select to authenticated using (public.is_member(id));
create policy camps_update on public.camps for update to authenticated using (public.has_role(id, '{director}')) with check (public.has_role(id, '{director}'));

-- Sessions and requirements: every staff member reads; director and office change.
create policy sessions_read on public.sessions for select to authenticated using (public.is_member(camp_id));
create policy sessions_write on public.sessions for all to authenticated using (public.has_role(camp_id, '{director,office}')) with check (public.has_role(camp_id, '{director,office}'));
create policy requirements_read on public.requirements for select to authenticated using (public.is_member(camp_id));
create policy requirements_write on public.requirements for all to authenticated using (public.has_role(camp_id, '{director,office}')) with check (public.has_role(camp_id, '{director,office}'));

-- Staff: the director manages everyone; everyone sees their own rows.
create policy staff_read on public.staff for select to authenticated using (email = public.my_email() or public.has_role(camp_id, '{director}'));
create policy staff_write on public.staff for all to authenticated using (public.has_role(camp_id, '{director}')) with check (public.has_role(camp_id, '{director}'));

-- Families: office-side roles only. Counselors never see family records.
create policy families_read on public.families for select to authenticated using (public.has_role(camp_id, '{director,office,finance,infirmary}'));
create policy families_write on public.families for all to authenticated using (public.has_role(camp_id, '{director,office}')) with check (public.has_role(camp_id, '{director,office}'));

-- Campers: office-side roles, and head counselors for their sessions. Counselors use bunk_list().
create policy campers_read on public.campers for select to authenticated using (public.has_role(camp_id, '{director,office,finance,infirmary}') or public.head_counselor_camper(id));
create policy campers_write on public.campers for all to authenticated using (public.has_role(camp_id, '{director,office}')) with check (public.has_role(camp_id, '{director,office}'));

create policy enrollments_read on public.enrollments for select to authenticated using (public.has_role(camp_id, '{director,office,finance,infirmary}') or public.head_counselor_session(camp_id, session_id));
create policy enrollments_write on public.enrollments for all to authenticated using (public.has_role(camp_id, '{director,office}')) with check (public.has_role(camp_id, '{director,office}'));

-- Bunks: everyone reads the bunk names; director, office and the session's head counselors change them.
create policy bunks_read on public.bunks for select to authenticated using (public.is_member(camp_id));
create policy bunks_write on public.bunks for all to authenticated using (public.has_role(camp_id, '{director,office}') or public.head_counselor_session(camp_id, session_id))
  with check (public.has_role(camp_id, '{director,office}') or public.head_counselor_session(camp_id, session_id));

create policy assignments_read on public.bunk_assignments for select to authenticated using (public.has_role(camp_id, '{director,office,infirmary}')
  or exists (select 1 from public.bunks b where b.id = bunk_id and public.head_counselor_session(b.camp_id, b.session_id)));
create policy assignments_write on public.bunk_assignments for all to authenticated
  using (public.has_role(camp_id, '{director,office}') or exists (select 1 from public.bunks b where b.id = bunk_id and public.head_counselor_session(b.camp_id, b.session_id)))
  with check (public.has_role(camp_id, '{director,office}') or exists (select 1 from public.bunks b where b.id = bunk_id and public.head_counselor_session(b.camp_id, b.session_id)));

-- Form contents: director, office and infirmary read; office and infirmary record and review; director deletes.
create policy submissions_read on public.submissions for select to authenticated using (public.has_role(camp_id, '{director,office,infirmary}'));
create policy submissions_insert on public.submissions for insert to authenticated with check (public.has_role(camp_id, '{director,office,infirmary}') and submitted_by = public.my_email());
create policy submissions_update on public.submissions for update to authenticated using (public.has_role(camp_id, '{director,infirmary}')) with check (public.has_role(camp_id, '{director,infirmary}'));
create policy submissions_delete on public.submissions for delete to authenticated using (public.has_role(camp_id, '{director}'));

create policy health_read on public.camper_health for select to authenticated using (public.has_role(camp_id, '{director,office,infirmary}'));
create policy health_write on public.camper_health for all to authenticated using (public.has_role(camp_id, '{director,infirmary}')) with check (public.has_role(camp_id, '{director,infirmary}'));

-- SFSP: status only, written by the server.
create policy sfsp_read on public.sfsp_forms for select to authenticated using (public.has_role(camp_id, '{director,office}'));

-- Family links: server only (no policy = no access for signed-in staff).

create policy reminders_read on public.reminder_log for select to authenticated using (public.has_role(camp_id, '{director,office}'));

-- Money: director and finance read; nobody writes from the app this season.
create policy finance_accounts_read on public.finance_accounts for select to authenticated using (public.has_role(camp_id, '{director,finance}'));
create policy finance_entries_read on public.finance_entries for select to authenticated using (public.has_role(camp_id, '{director,finance}'));

create policy imports_read on public.import_runs for select to authenticated using (public.has_role(camp_id, '{director,office}'));
create policy audit_read on public.audit_log for select to authenticated using (public.has_role(camp_id, '{director}'));

-- ---------------------------------------------------------------------------------------------------------------
-- Activity log: changes to people, access and forms are recorded with who made them.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; camp uuid; actor text;
begin
  r := to_jsonb(coalesce(new, old));
  camp := (r ->> 'camp_id')::uuid;
  actor := coalesce(public.my_email(), 'system');
  insert into public.audit_log (camp_id, actor, action, entity, entity_id, detail)
  values (camp, actor, lower(tg_op), tg_table_name, coalesce(r ->> 'id', r ->> 'camper_id', r ->> 'family_id'),
    case when tg_table_name = 'submissions' then jsonb_build_object('status', r ->> 'status', 'requirement', r ->> 'requirement_id', 'camper', r ->> 'camper_id')
         when tg_table_name = 'staff' then jsonb_build_object('email', r ->> 'email', 'role', r ->> 'role')
         when tg_table_name = 'bunk_assignments' then jsonb_build_object('bunk', r ->> 'bunk_id', 'camper', r ->> 'camper_id')
         else null end);
  return coalesce(new, old);
end $$;

create trigger audit_staff after insert or update or delete on public.staff for each row execute function public.audit_row();
create trigger audit_submissions after insert or update or delete on public.submissions for each row execute function public.audit_row();
create trigger audit_assignments after insert or delete on public.bunk_assignments for each row execute function public.audit_row();
create trigger audit_health after insert or update or delete on public.camper_health for each row execute function public.audit_row();

-- Staff opening a health file call this first; it records the view.
create or replace function public.log_file_view(p_submission uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare camp uuid;
begin
  select s.camp_id into camp from public.submissions s where s.id = p_submission;
  if camp is null or not public.has_role(camp, '{director,office,infirmary}') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.submissions s, jsonb_array_elements(s.files) f where s.id = p_submission and f ->> 'path' = p_path) then raise exception 'not allowed'; end if;
  insert into public.audit_log (camp_id, actor, action, entity, entity_id, detail) values (camp, public.my_email(), 'view', 'file', p_submission::text, jsonb_build_object('path', p_path));
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- New camps start with the standard requirements.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.seed_requirements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.requirements (camp_id, key, label, help, scope, kind, health, config, sort) values
    (new.id, 'sfsp', 'SFSP meal form', 'Summer Food Service Program income form', 'family', 'sfsp', false, '{}', 10),
    (new.id, 'insurance', 'Health insurance', 'Insurance company, member ID and a photo of the front and back of the card', 'camper', 'upload', true,
      '{"fields":[{"key":"carrier","label":"Insurance company"},{"key":"member_id","label":"Member ID"},{"key":"group","label":"Group number","optional":true},{"key":"holder","label":"Policy holder"}],"min_files":1}', 20),
    (new.id, 'physical', 'Physical exam', 'Signed by the doctor, dated within the last 12 months', 'camper', 'upload', true, '{"min_files":1}', 30),
    (new.id, 'immunizations', 'Immunization record', 'From the doctor or school', 'camper', 'upload', true, '{"min_files":1}', 40),
    (new.id, 'consent', 'Consent to treat', 'Permission for camp medical staff to treat your child', 'family', 'consent', true,
      '{"accept_disclosure":null,"text":"I give permission for the camp''s medical staff to provide first aid and medical treatment to my child or children, and, in an emergency, to arrange treatment by a doctor or hospital if I cannot be reached."}', 50),
    (new.id, 'medical_history', 'Medical history', 'Allergies, medical conditions and medications', 'camper', 'questionnaire', true, '{}', 60);
  return new;
end $$;
create trigger camps_seed after insert on public.camps for each row execute function public.seed_requirements();
