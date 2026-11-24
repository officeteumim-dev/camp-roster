-- Every Camp Flow column comes in: camper approval status and dates get their own fields; other camper columns become
-- camper details (cf_<column>, created by the import); family columns with no field are kept in families.extra.
alter table public.campers
  add column approval_status text,
  add column applied_at timestamptz,
  add column accepted_at timestamptz,
  add column campflow_enrollment_id text;
alter table public.families add column extra jsonb not null default '{}'::jsonb;

-- (Its variable is renamed so it doesn't clash with the new families.extra column.)
create or replace function public.accept_application_as(p_id uuid, p_family uuid, p_by text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.applications; d jsonb; fam uuid; k jsonb; cid uuid; sid text; form jsonb; q jsonb; ans jsonb; v_extra jsonb := '{}'::jsonb; val text;
begin
  select * into a from public.applications where id = p_id for update;
  if a.kind <> 'camper' then raise exception 'Only camper applications can be added to the roster.'; end if;
  if a.status not in ('submitted', 'waitlisted') then raise exception 'This application has already been decided.'; end if;
  d := a.data;
  select c.settings #> '{registration,camper,form}' into form from public.camps c where c.id = a.camp_id;
  -- Family answers (and the payment plan) are kept with the family, by question.
  for q in select * from jsonb_array_elements(coalesce(form -> 'custom', '[]')) loop
    continue when q ->> 'section' = 'camper';
    ans := d -> 'custom' -> (q ->> 'id');
    continue when ans is null or ans = '""'::jsonb or ans = '[]'::jsonb;
    v_extra := v_extra || jsonb_build_object(q ->> 'label', case when jsonb_typeof(ans) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(ans) x) else ans #>> '{}' end);
  end loop;
  if coalesce(d ->> 'payment_plan_name', '') <> '' then v_extra := v_extra || jsonb_build_object('Payment plan', d ->> 'payment_plan_name'); end if;
  if coalesce(d ->> 'notes', '') <> '' then v_extra := v_extra || jsonb_build_object('Registration notes', left(d ->> 'notes', 2000)); end if;
  if p_family is not null then
    select id into fam from public.families where id = p_family and camp_id = a.camp_id;
    if fam is null then raise exception 'Family not found'; end if;
    update public.families set disclosures = coalesce(disclosures, '{}') || v_extra where id = fam;
  else
    insert into public.families (camp_id, external_id, last_name, father_title, father_first, father_phone, father_email, father_occupation,
      mother_title, mother_first, mother_phone, mother_email, mother_occupation, maiden_name, address, city, state, zip, emergency_contacts, applied_at, disclosures)
    values (a.camp_id, 'online:' || a.id, trim(coalesce(d ->> 'last_name', '')),
      nullif(d #>> '{father,title}', ''), nullif(d #>> '{father,first}', ''), nullif(d #>> '{father,phone}', ''), lower(nullif(d #>> '{father,email}', '')), nullif(d #>> '{father,occupation}', ''),
      nullif(d #>> '{mother,title}', ''), nullif(d #>> '{mother,first}', ''), nullif(d #>> '{mother,phone}', ''), lower(nullif(d #>> '{mother,email}', '')), nullif(d #>> '{mother,occupation}', ''),
      nullif(d #>> '{mother,maiden}', ''), nullif(d ->> 'address', ''), nullif(d ->> 'city', ''), nullif(d ->> 'state', ''), nullif(d ->> 'zip', ''),
      coalesce((select array_agg(concat_ws(', ', nullif(e ->> 'name', ''), nullif(e ->> 'relation', ''), nullif(e ->> 'phone', ''))) from jsonb_array_elements(coalesce(d -> 'emergency', '[]')) e where coalesce(e ->> 'name', '') <> ''), '{}'),
      a.submitted_at, v_extra)
    returning id into fam;
  end if;
  for k in select * from jsonb_array_elements(coalesce(d -> 'campers', '[]')) loop
    insert into public.campers (camp_id, family_id, first_name, last_name, date_of_birth, gender, grade, hebrew_name)
    values (a.camp_id, fam, trim(k ->> 'first'), coalesce(nullif(trim(k ->> 'last'), ''), trim(coalesce(d ->> 'last_name', ''))),
      nullif(k ->> 'dob', '')::date, nullif(k ->> 'gender', ''), nullif(k ->> 'grade', ''), nullif(k ->> 'hebrew_name', ''))
    returning id into cid;
    for sid in select jsonb_array_elements_text(coalesce(k -> 'sessions', '[]')) loop
      insert into public.enrollments (camper_id, session_id, camp_id, division_id)
      select cid, s.id, a.camp_id, (select dv.id from public.divisions dv where dv.session_id = s.id and dv.id::text = coalesce(k -> 'divisions' ->> sid, k ->> 'division'))
      from public.sessions s where s.id::text = sid and s.camp_id = a.camp_id on conflict do nothing;
    end loop;
    -- Camper answers become camper details.
    for q in select * from jsonb_array_elements(coalesce(form -> 'custom', '[]')) loop
      continue when q ->> 'section' <> 'camper';
      ans := k -> 'custom' -> (q ->> 'id');
      continue when ans is null;
      val := case when jsonb_typeof(ans) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(ans) x) else ans #>> '{}' end;
      continue when coalesce(val, '') = '';
      insert into public.camper_fields (camper_id, camp_id, item_key, value, updated_by)
      select cid, a.camp_id, 'f_reg_' || (q ->> 'id'), left(val, 500), 'registration form'
      where exists (select 1 from public.perm_items where camp_id = a.camp_id and key = 'f_reg_' || (q ->> 'id'))
      on conflict do nothing;
    end loop;
  end loop;
  update public.applications set status = 'accepted', family_id = fam, decided_by = p_by, decided_at = now() where id = p_id;
  return fam;
end $$;



create or replace function public.registration_report(p_camp uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with new_c as (
    select c.* from public.campers c join public.families f on f.id = c.family_id
    where c.camp_id = p_camp and c.active and f.active and c.created_at >= p_from and c.created_at < p_to
  ), fams as (
    select f.* from public.families f where f.id in (select family_id from new_c)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'campers', (select count(*) from new_c),
    'families', (select count(*) from fams),
    'new_families', (select count(*) from fams f where f.created_at >= p_from and f.created_at < p_to),
    'list', coalesce((select jsonb_agg(row order by row ->> 'last_name', row ->> 'parents') from (
      -- Every detail the director might choose as a column (Settings → Daily registration report).
      select jsonb_build_object(
        'family_id', f.id, 'last_name', f.last_name, 'parents', concat_ws(' & ', f.father_first, f.mother_first),
        'new_family', f.created_at >= p_from, 'applied_at', f.applied_at, 'city', f.city, 'state', f.state,
        'phone', coalesce(f.father_phone, f.mother_phone), 'email', coalesce(f.father_email, f.mother_email),
        'campflow_id', replace(f.external_id, 'campflow:', ''), 'extra', coalesce(f.extra, '{}'::jsonb), 'disclosures', coalesce(f.disclosures, '{}'::jsonb),
        'father_title', f.father_title, 'mother_title', f.mother_title, 'marital_status', f.marital_status, 'family_last_name', f.last_name,
        'money', (select jsonb_build_object('charges', a.total_charges_cents, 'payments', a.total_payments_cents, 'pending', a.pending_payments_cents,
           'autopay', a.upcoming_autopay, 'after', a.balance_after_expected_cents, 'methods', a.payment_methods, 'active_autopay', a.active_autopay, 'paused_autopay', a.paused_autopay)
           from public.finance_accounts a where a.family_id = f.id),
        'father', trim(concat_ws(' ', f.father_title, f.father_first, f.last_name)), 'father_phone', f.father_phone, 'father_email', f.father_email, 'father_occupation', f.father_occupation,
        'mother', trim(concat_ws(' ', f.mother_title, f.mother_first, f.last_name)), 'mother_phone', f.mother_phone, 'mother_email', f.mother_email, 'mother_occupation', f.mother_occupation,
        'maiden_name', f.maiden_name, 'address', concat_ws(', ', nullif(f.address, ''), nullif(f.city, ''), nullif(trim(concat_ws(' ', f.state, f.zip)), '')),
        'zip', f.zip, 'affiliation', f.affiliation, 'emergency', array_to_string(f.emergency_contacts, '; '),
        'balance_cents', (select a.balance_cents from public.finance_accounts a where a.family_id = f.id),
        'sfsp', (select public.status_for(r.id, f.id, null) from public.requirements r where r.camp_id = p_camp and r.kind = 'sfsp' and r.active limit 1),
        'campers', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', trim(c.first_name || ' ' || c.last_name), 'first_name', c.first_name, 'last_name', c.last_name, 'grade', c.grade,
                       'gender', c.gender, 'dob', c.date_of_birth, 'hebrew_name', c.hebrew_name, 'staff_child', c.staff_child,
                       'approval_status', c.approval_status, 'accepted_at', c.accepted_at, 'applied_at', c.applied_at,
                       'campflow_camper_id', replace(c.external_id, 'campflow:camper:', ''), 'enrollment_id', c.campflow_enrollment_id,
                       'legal_name', nullif(trim(concat_ws(' ', c.legal_first, c.legal_last)), ''), 'campflow_camper_id', replace(c.external_id, 'campflow:camper:', ''),
                       'alert', (select h.alert from public.camper_health h where h.camper_id = c.id),
                       'bunks', coalesce((select jsonb_agg(b.name order by b.name) from public.bunk_assignments ba join public.bunks b on b.id = ba.bunk_id where ba.camper_id = c.id), '[]'::jsonb),
                       'missing_forms', coalesce((select jsonb_agg(r.label order by r.sort) from public.requirements r
                          where r.camp_id = p_camp and r.active and public.status_for(r.id, c.family_id, case when r.scope = 'camper' then c.id end) in ('missing', 'rejected')), '[]'::jsonb),
                       'sessions', coalesce((select jsonb_agg(s.name order by s.starts_on nulls last) from public.enrollments e join public.sessions s on s.id = e.session_id where e.camper_id = c.id), '[]'::jsonb),
                       'divisions', coalesce((select jsonb_agg(dv.name order by s.starts_on nulls last) from public.enrollments e join public.sessions s on s.id = e.session_id join public.divisions dv on dv.id = e.division_id where e.camper_id = c.id), '[]'::jsonb),
                       'fields', coalesce((select jsonb_object_agg(cf.item_key, cf.value) from public.camper_fields cf where cf.camper_id = c.id and cf.value is not null), '{}'::jsonb))
                     order by c.first_name) from new_c c where c.family_id = f.id)) as row
      from fams f) t), '[]'::jsonb))
$$;
