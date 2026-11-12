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


-- ---------- SFSP spec v1 ----------
-- The shared secret goes into Vault; the director sees only "saved"; the server reads it back.
begin; do $$ begin perform pg_temp.as_user('dir@x.org'); end $$;
select set_sfsp_connection('00000000-0000-0000-0000-0000000000c1', 'camp-teumim', 'https://www.wgcamps.com/apply.html', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
do $$ begin
  assert (sfsp_connection('00000000-0000-0000-0000-0000000000c1') ->> 'has_secret')::boolean, 'secret saved';
  assert not (sfsp_connection('00000000-0000-0000-0000-0000000000c1') ? 'secret'), 'secret never shown back';
end $$;
do $$ begin
  perform sfsp_secret_for(null, 'camp-teumim');
  raise exception 'staff should not read the secret';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform set_sfsp_connection('00000000-0000-0000-0000-0000000000c1', 'camp teumim', null, null);
  raise exception 'bad camp ID accepted';
exception when raise_exception then if sqlerrm like '%bad camp ID%' then raise; end if; end $$;
reset role;
set local role service_role;
do $$ begin
  assert (select secret from sfsp_secret_for(null, 'camp-teumim')) = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', 'server reads it';
  assert (select camp_id from sfsp_secret_for('00000000-0000-0000-0000-0000000000c1', null)) = '00000000-0000-0000-0000-0000000000c1', 'by our camp ID too';
end $$;
reset role;
do $$ begin perform pg_temp.as_user('dir@x.org'); end $$;
select set_sfsp_connection('00000000-0000-0000-0000-0000000000c1', 'camp-teumim', 'https://www.wgcamps.com/apply.html', null);
reset role; set local role service_role;
do $$ begin assert (select secret from sfsp_secret_for(null, 'camp-teumim')) = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', 'blank keeps the saved secret'; end $$;
rollback;

-- Age rule, pre-fill and roster.
begin; set local role service_role;
update sessions set starts_on = '2027-06-29', ends_on = '2027-07-23' where id = '00000000-0000-0000-0000-0000000000e1';
update sessions set starts_on = '2027-07-25', ends_on = '2027-08-18' where id = '00000000-0000-0000-0000-0000000000e2';
-- Cohen family: one child, 19 on the first day of his session -> SFSP not needed.
update campers set date_of_birth = '2008-06-29' where id = '00000000-0000-0000-0000-0000000000a3';
-- Levi family: Yosef 19+, Chaim 13 -> still needed.
update campers set date_of_birth = '2005-01-01' where id = '00000000-0000-0000-0000-0000000000a1';
update campers set date_of_birth = '2014-05-05', legal_first = 'Hyman', hebrew_name = 'Chaim', staff_child = true where id = '00000000-0000-0000-0000-0000000000a2';
delete from sfsp_forms;
insert into camp_secrets (camp_id, sfsp_camp_id) values ('00000000-0000-0000-0000-0000000000c1', 'camp-teumim');
do $$ declare p jsonb; r jsonb; begin
  assert sfsp_too_old('00000000-0000-0000-0000-0000000000a3'), '19 on the first day is too old';
  assert not sfsp_needed('00000000-0000-0000-0000-0000000000f2'), 'all children too old: no form needed';
  assert sfsp_needed('00000000-0000-0000-0000-0000000000f1'), 'one eligible child: form needed';
  assert status_for((select id from requirements where key = 'sfsp' and camp_id = '00000000-0000-0000-0000-0000000000c1'), '00000000-0000-0000-0000-0000000000f2', null) = 'not_needed', 'status not needed';
  assert not exists (select 1 from families_missing('00000000-0000-0000-0000-0000000000c1') m, jsonb_array_elements(m.items) i where m.last_name = 'Cohen' and i ->> 'key' = 'sfsp'), 'no SFSP reminder for Cohen';
  update campers set date_of_birth = '2008-06-30' where id = '00000000-0000-0000-0000-0000000000a3';
  assert not sfsp_too_old('00000000-0000-0000-0000-0000000000a3'), 'turns 19 the day after: still eligible';

  p := sfsp_prefill('00000000-0000-0000-0000-0000000000c1', 'campflow:111');
  assert p ->> 'household' = 'campflow:111', 'pre-fill household';
  assert p -> 'parent' ->> 'phone' = '7325550101', 'phone digits only';
  assert jsonb_array_length(p -> 'children') = 2, 'both children';
  assert p -> 'children' @> '[{"id":"00000000-0000-0000-0000-0000000000a2","legalFirst":"Hyman","legalLast":"Levi","hebrewName":"Chaim","dob":"2014-05-05","sessions":["00000000-0000-0000-0000-0000000000e2"]}]', 'child fields';
  assert not (p -> 'children' -> 0 ? 'staffChild'), 'pre-fill has no staff flag';
  assert p -> 'sessions' = '[{"id":"00000000-0000-0000-0000-0000000000e1","name":"First half","start":"2027-06-29","end":"2027-07-23"},{"id":"00000000-0000-0000-0000-0000000000e2","name":"Second half","start":"2027-07-25","end":"2027-08-18"}]'::jsonb, 'pre-fill lists the children''s sessions with dates';
  assert jsonb_array_length(sfsp_prefill('00000000-0000-0000-0000-0000000000c1', 'campflow:222') -> 'sessions') = 1, 'only this family''s sessions';
  assert sfsp_prefill('00000000-0000-0000-0000-0000000000c1', 'campflow:999') is null, 'unknown household';
  assert sfsp_prefill('00000000-0000-0000-0000-0000000000c2', 'campflow:111') is null, 'other camp';

  r := sfsp_roster('00000000-0000-0000-0000-0000000000c1');
  assert r ->> 'camp' = 'camp-teumim', 'roster camp';
  assert r -> 'sessions' @> '[{"id":"00000000-0000-0000-0000-0000000000e1","name":"First half","start":"2027-06-29","end":"2027-07-23"}]', 'sessions';
  assert jsonb_array_length(r -> 'households') = 2, 'households';
  assert r -> 'households' @> '[{"id":"campflow:111","lastName":"Levi","phone":"7325550101","children":[{"legalFirst":"Hyman","staffChild":true}]}]', 'roster child';
  assert not (r::text like '%@%'), 'no emails in the roster';
  assert not (r::text like '%Oak%'), 'no street addresses';
end $$;
rollback;

-- Rate limit.
begin; set local role service_role;
do $$ declare ok int := 0; begin
  for i in 1..35 loop if rate_ok('ip:1.2.3.4', 30, 60) then ok := ok + 1; end if; end loop;
  assert ok = 30, 'only 30 a minute';
  assert rate_ok('ip:5.6.7.8', 30, 60), 'other IPs unaffected';
end $$; rollback;

\echo 'ALL DATABASE TESTS PASSED'
