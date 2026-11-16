-- Report data: first and last name separately, so every Roster column can be a report column.
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
        'campflow_id', replace(f.external_id, 'campflow:', ''),
        'father', trim(concat_ws(' ', f.father_title, f.father_first, f.last_name)), 'father_phone', f.father_phone, 'father_email', f.father_email, 'father_occupation', f.father_occupation,
        'mother', trim(concat_ws(' ', f.mother_title, f.mother_first, f.last_name)), 'mother_phone', f.mother_phone, 'mother_email', f.mother_email, 'mother_occupation', f.mother_occupation,
        'maiden_name', f.maiden_name, 'address', concat_ws(', ', nullif(f.address, ''), nullif(f.city, ''), nullif(trim(concat_ws(' ', f.state, f.zip)), '')),
        'zip', f.zip, 'affiliation', f.affiliation, 'emergency', array_to_string(f.emergency_contacts, '; '),
        'balance_cents', (select a.balance_cents from public.finance_accounts a where a.family_id = f.id),
        'sfsp', (select public.status_for(r.id, f.id, null) from public.requirements r where r.camp_id = p_camp and r.kind = 'sfsp' and r.active limit 1),
        'campers', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', trim(c.first_name || ' ' || c.last_name), 'first_name', c.first_name, 'last_name', c.last_name, 'grade', c.grade,
                       'gender', c.gender, 'dob', c.date_of_birth, 'hebrew_name', c.hebrew_name, 'staff_child', c.staff_child,
                       'legal_name', nullif(trim(concat_ws(' ', c.legal_first, c.legal_last)), ''), 'campflow_camper_id', replace(c.external_id, 'campflow:camper:', ''),
                       'alert', (select h.alert from public.camper_health h where h.camper_id = c.id),
                       'bunks', coalesce((select jsonb_agg(b.name order by b.name) from public.bunk_assignments ba join public.bunks b on b.id = ba.bunk_id where ba.camper_id = c.id), '[]'::jsonb),
                       'missing_forms', coalesce((select jsonb_agg(r.label order by r.sort) from public.requirements r
                          where r.camp_id = p_camp and r.active and public.status_for(r.id, c.family_id, case when r.scope = 'camper' then c.id end) in ('missing', 'rejected')), '[]'::jsonb),
                       'sessions', coalesce((select jsonb_agg(s.name order by s.starts_on nulls last) from public.enrollments e join public.sessions s on s.id = e.session_id where e.camper_id = c.id), '[]'::jsonb),
                       'fields', coalesce((select jsonb_object_agg(cf.item_key, cf.value) from public.camper_fields cf where cf.camper_id = c.id and cf.value is not null), '{}'::jsonb))
                     order by c.first_name) from new_c c where c.family_id = f.id)) as row
      from fams f) t), '[]'::jsonb))
$$;
