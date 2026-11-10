-- Role and status tests. Run by tests/db/run.sh on a throwaway local database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- Seed as the server (service role) ----------
set role service_role;
insert into camps (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000c1', 'Camp One', 'camp-one'),
  ('00000000-0000-0000-0000-0000000000c2', 'Camp Two', 'camp-two');
insert into sessions (id, camp_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'First half'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c1', 'Second half');
insert into bunks (id, camp_id, session_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'Bunk A'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', 'Bunk B');
insert into staff (camp_id, email, role, session_id, bunk_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'dir@x.org', 'director', null, null),
  ('00000000-0000-0000-0000-0000000000c1', 'office@x.org', 'office', null, null),
  ('00000000-0000-0000-0000-0000000000c1', 'fin@x.org', 'finance', null, null),
  ('00000000-0000-0000-0000-0000000000c1', 'nurse@x.org', 'infirmary', null, null),
  ('00000000-0000-0000-0000-0000000000c1', 'head@x.org', 'head_counselor', '00000000-0000-0000-0000-0000000000e1', null),
  ('00000000-0000-0000-0000-0000000000c1', 'coun@x.org', 'counselor', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c2', 'other@x.org', 'director', null, null);
insert into families (id, camp_id, external_id, last_name, father_first, father_email, father_phone, disclosures) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'campflow:111', 'Levi', 'Moshe', 'moshe@x.org', '(732) 555-0101', '{"Medical Authorization":"Yes"}'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'campflow:222', 'Cohen', 'Dovid', 'dovid@x.org', '(732) 555-0202', '{}');
insert into campers (id, camp_id, family_id, first_name, last_name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'Yosef', 'Levi'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'Chaim', 'Levi'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f2', 'Shmuel', 'Cohen');
insert into enrollments (camper_id, session_id, camp_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1');
insert into bunk_assignments (bunk_id, camper_id, camp_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1');
insert into camper_health (camper_id, camp_id, alert, allergies) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Peanut allergy, EpiPen', 'Peanuts (anaphylaxis)');
insert into finance_accounts (family_id, camp_id, balance_cents) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 120000);
insert into submissions (camp_id, requirement_id, family_id, camper_id, status, submitted_by)
  select '00000000-0000-0000-0000-0000000000c1', r.id, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'received', 'family'
  from requirements r where r.camp_id = '00000000-0000-0000-0000-0000000000c1' and r.key = 'physical';
insert into sfsp_forms (camp_id, form_id, household, state) values ('00000000-0000-0000-0000-0000000000c1', 'abc', 'campflow:111', 'received');
reset role;

-- Helper: act as a signed-in person for the rest of a transaction.
create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', p_email)::text, true);
  execute 'set local role authenticated';
end $$;

do $$ begin assert (select count(*) from requirements where camp_id = '00000000-0000-0000-0000-0000000000c1') = 6, 'standard requirements seeded'; end $$;

-- ---------- Director sees everything in their own camp, nothing in another ----------
begin; do $$ begin perform pg_temp.as_user('dir@x.org'); end $$;
do $$ begin
  assert (select count(*) from families) = 2, 'director sees both families';
  assert (select count(*) from finance_accounts) = 1, 'director sees money';
  assert (select count(*) from staff) = 6, 'director sees camp one staff only';
  assert (select count(*) from camps) = 1, 'director sees only own camp';
end $$; rollback;

begin; do $$ begin perform pg_temp.as_user('other@x.org'); end $$;
do $$ begin
  assert (select count(*) from families) = 0, 'other camp sees no families';
  assert (select count(*) from submissions) = 0, 'other camp sees no forms';
end $$; rollback;

-- ---------- Finance: money yes, health no ----------
begin; do $$ begin perform pg_temp.as_user('fin@x.org'); end $$;
do $$ begin
  assert (select count(*) from finance_accounts) = 1, 'finance sees balances';
  assert (select count(*) from submissions) = 0, 'finance sees no forms';
  assert (select count(*) from camper_health) = 0, 'finance sees no health info';
end $$; rollback;

-- ---------- Infirmary: health yes, money no ----------
begin; do $$ begin perform pg_temp.as_user('nurse@x.org'); end $$;
do $$ begin
  assert (select count(*) from submissions) = 1, 'infirmary sees forms';
  assert (select count(*) from camper_health) = 1, 'infirmary sees health';
  assert (select count(*) from finance_accounts) = 0, 'infirmary sees no money';
end $$;
update submissions set status = 'approved', reviewed_by = 'nurse@x.org' where status = 'received';
do $$ begin assert (select count(*) from submissions where status = 'approved') = 1, 'infirmary can approve'; end $$;
rollback;

-- ---------- Office: can view forms but not approve them ----------
begin; do $$ begin perform pg_temp.as_user('office@x.org'); end $$;
update submissions set status = 'approved' where status = 'received';
do $$ begin assert (select count(*) from submissions where status = 'approved') = 0, 'office cannot approve'; end $$;
do $$ begin assert (select count(*) from finance_accounts) = 0, 'office sees no money'; end $$;
rollback;

-- ---------- Counselor: own bunk list with alerts, nothing else ----------
begin; do $$ begin perform pg_temp.as_user('coun@x.org'); end $$;
do $$ begin
  assert (select count(*) from families) = 0, 'counselor sees no families';
  assert (select count(*) from campers) = 0, 'counselor sees no camper records directly';
  assert (select count(*) from camper_health) = 0, 'counselor sees no health records';
  assert (select count(*) from bunk_list('00000000-0000-0000-0000-0000000000b1')) = 1, 'counselor sees own bunk';
  assert (select alert from bunk_list('00000000-0000-0000-0000-0000000000b1')) = 'Peanut allergy, EpiPen', 'counselor sees the alert';
end $$;
do $$ begin
  perform bunk_list('00000000-0000-0000-0000-0000000000b2');
  raise exception 'counselor should not see another bunk';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into bunk_assignments (bunk_id, camper_id, camp_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1');
  raise exception 'counselor should not edit bunks';
exception when insufficient_privilege then null; end $$;
rollback;

-- ---------- Head counselor: own session's bunks, can edit them ----------
begin; do $$ begin perform pg_temp.as_user('head@x.org'); end $$;
do $$ begin
  assert (select count(*) from campers) = 2, 'head counselor sees first-half campers only';
  assert (select count(*) from families) = 0, 'head counselor sees no families';
end $$;
insert into bunk_assignments (bunk_id, camper_id, camp_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1');
do $$ begin
  insert into bunk_assignments (bunk_id, camper_id, camp_id) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1');
  raise exception 'head counselor should not edit the other session';
exception when insufficient_privilege then null; end $$;
rollback;

-- ---------- Statuses ----------
begin; do $$ begin perform pg_temp.as_user('office@x.org'); end $$;
do $$ declare s jsonb; begin
  select statuses into s from form_status('00000000-0000-0000-0000-0000000000c1') where first_name = 'Yosef';
  assert s ->> 'sfsp' = 'received', 'SFSP received from the SFSP app';
  assert s ->> 'physical' = 'received', 'physical received';
  assert s ->> 'insurance' = 'missing', 'insurance missing';
  assert s ->> 'consent' = 'missing', 'consent missing until the disclosure is accepted';
  select statuses into s from form_status('00000000-0000-0000-0000-0000000000c1') where first_name = 'Shmuel';
  assert s ->> 'sfsp' = 'missing', 'other household has no SFSP form';
  assert (select count(*) from form_status('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2')) = 1, 'session filter';
end $$; rollback;

begin; do $$ begin perform pg_temp.as_user('coun@x.org'); end $$;
do $$ begin
  perform form_status('00000000-0000-0000-0000-0000000000c1');
  raise exception 'counselor should not see the dashboard';
exception when insufficient_privilege then null; end $$;
rollback;

-- Accepting Camp Flow's Medical Authorization disclosure ticks consent for families that said Yes.
begin; set local role service_role;
update requirements set config = config || '{"accept_disclosure":"Medical Authorization"}' where key = 'consent';
do $$ begin
  assert status_for((select id from requirements where key = 'consent' and camp_id = '00000000-0000-0000-0000-0000000000c1'), '00000000-0000-0000-0000-0000000000f1', null) = 'approved', 'disclosure counts';
  assert status_for((select id from requirements where key = 'consent' and camp_id = '00000000-0000-0000-0000-0000000000c1'), '00000000-0000-0000-0000-0000000000f2', null) = 'missing', 'no disclosure, still missing';
end $$; rollback;

-- A rejection after a receipt counts as missing again.
begin; set local role service_role;
insert into submissions (camp_id, requirement_id, family_id, camper_id, status, submitted_by, reject_reason, created_at)
  select camp_id, requirement_id, family_id, camper_id, 'rejected', 'nurse@x.org', 'Not signed', now() + interval '1 minute' from submissions;
do $$ declare m jsonb; begin
  select items into m from families_missing('00000000-0000-0000-0000-0000000000c1') where last_name = 'Levi';
  assert m @> '[{"camper":"Yosef","key":"physical","status":"rejected"}]', 'rejected physical is listed as missing';
  assert not m @> '[{"key":"sfsp"}]', 'SFSP not listed for Levi';
end $$; rollback;

-- Server-only functions are closed to staff.
begin; do $$ begin perform pg_temp.as_user('dir@x.org'); end $$;
do $$ begin
  perform families_missing('00000000-0000-0000-0000-0000000000c1');
  raise exception 'families_missing should be server only';
exception when insufficient_privilege then null; end $$;
rollback;

-- Portal view and SFSP household list (server).
begin; set local role service_role;
do $$ declare v jsonb; h jsonb; begin
  v := portal_view('00000000-0000-0000-0000-0000000000f1');
  assert jsonb_array_length(v -> 'campers') = 2, 'portal lists both campers';
  assert jsonb_array_length(v -> 'campers' -> 0 -> 'requirements') = 4, 'four camper-level requirements';
  h := sfsp_households('00000000-0000-0000-0000-0000000000c1');
  assert h @> '[{"household":"campflow:111","children":["Chaim","Yosef"],"phones":["7325550101"]}]', 'households list for SFSP matching';
end $$; rollback;

-- Activity log records who changed what.
begin; do $$ begin perform pg_temp.as_user('nurse@x.org'); end $$;
update submissions set status = 'approved' where status = 'received';
reset role;
do $$ begin assert exists (select 1 from audit_log where actor = 'nurse@x.org' and entity = 'submissions' and action = 'update'), 'review logged'; end $$;
rollback;

\echo 'ALL DATABASE TESTS PASSED'
