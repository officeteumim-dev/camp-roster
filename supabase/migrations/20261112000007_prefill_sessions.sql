-- SFSP spec v1 (Nov 12 revision): the pre-fill answer also lists the children's sessions with their dates.
create or replace function public.sfsp_session_json(s public.sessions) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id::text, 'name', s.name,
    'start', coalesce(to_char(s.starts_on, 'YYYY-MM-DD'), ''), 'end', coalesce(to_char(s.ends_on, 'YYYY-MM-DD'), ''))
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
                          from public.campers c where c.family_id = f.id and c.active), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(public.sfsp_session_json(s) order by s.starts_on nulls last, s.name)
                          from public.sessions s where s.id in (select e.session_id from public.enrollments e join public.campers c on c.id = e.camper_id
                                                                where c.family_id = f.id and c.active)), '[]'::jsonb))
  from public.families f where f.camp_id = p_camp and f.external_id = p_household and f.active
$$;

create or replace function public.sfsp_roster(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'camp', (select sfsp_camp_id from public.camp_secrets where camp_id = p_camp),
    'sessions', coalesce((select jsonb_agg(public.sfsp_session_json(s) order by s.starts_on nulls last, s.name)
                  from public.sessions s where s.camp_id = p_camp), '[]'::jsonb),
    'households', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.external_id, 'lastName', coalesce(f.last_name, ''),
        'phone', coalesce(regexp_replace(coalesce(f.father_phone, f.mother_phone, ''), '\D', '', 'g'), ''), 'zip', coalesce(f.zip, ''),
        'children', (select jsonb_agg(public.sfsp_child_json(c) || jsonb_build_object('staffChild', c.staff_child) order by c.first_name)
                     from public.campers c where c.family_id = f.id and c.active)) order by f.last_name)
      from public.families f where f.camp_id = p_camp and f.active
        and exists (select 1 from public.campers c where c.family_id = f.id and c.active)), '[]'::jsonb))
$$;

revoke execute on function public.sfsp_session_json(public.sessions) from public, anon, authenticated;
grant execute on function public.sfsp_session_json(public.sessions), public.sfsp_prefill(uuid, text), public.sfsp_roster(uuid) to service_role;
revoke execute on function public.sfsp_prefill(uuid, text) from public, anon, authenticated;
revoke execute on function public.sfsp_roster(uuid) from public, anon, authenticated;
