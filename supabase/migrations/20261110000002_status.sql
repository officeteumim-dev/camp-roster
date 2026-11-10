-- Form status, bunk lists and the server-side views used by the family portal, reminders and the SFSP app.

-- One requirement's status for one family (and camper, for camper-level requirements):
-- 'approved' | 'received' | 'not_needed' | 'rejected' | 'missing'. The newest submission wins.
create or replace function public.status_for(p_req uuid, p_family uuid, p_camper uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when r.kind = 'sfsp' then
      case when exists (select 1 from public.sfsp_forms x join public.families f on f.id = p_family
                        where x.camp_id = r.camp_id and x.household = f.external_id and x.state = 'received')
           then 'received' else 'missing' end
    else coalesce(
      (select 'approved' from public.families f where f.id = p_family and r.kind = 'consent'
         and nullif(r.config ->> 'accept_disclosure', '') is not null
         and lower(coalesce(f.disclosures ->> (r.config ->> 'accept_disclosure'), '')) = 'yes'),
      (select s.status from public.submissions s
         where s.requirement_id = r.id and s.family_id = p_family
           and (case when r.scope = 'camper' then s.camper_id = p_camper else s.camper_id is null end)
         order by s.created_at desc limit 1),
      'missing')
  end
  from public.requirements r where r.id = p_req
$$;
revoke execute on function public.status_for(uuid, uuid, uuid) from public, anon;

-- The missing-forms dashboard: one row per active camper.
create or replace function public.form_status(p_camp uuid, p_session uuid default null)
returns table (camper_id uuid, family_id uuid, first_name text, last_name text, grade text, family_name text,
               sessions text[], bunks text[], statuses jsonb, missing int, paused_until date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(p_camp, '{director,office,infirmary}') then raise exception 'not allowed' using errcode = '42501'; end if;
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
  where c.camp_id = p_camp and c.active and f.active
    and (p_session is null or exists (select 1 from public.enrollments e where e.camper_id = c.id and e.session_id = p_session))
  order by f.last_name, c.first_name;
end $$;

-- Bunk list for counselors and head counselors: names, grade and the infirmary's alert only.
create or replace function public.bunk_list(p_bunk uuid)
returns table (camper_id uuid, first_name text, last_name text, grade text, alert text)
language plpgsql stable security definer set search_path = public as $$
declare b public.bunks;
begin
  select * into b from public.bunks where id = p_bunk;
  if b.id is null or not (
       public.has_role(b.camp_id, '{director,office,infirmary}')
    or public.head_counselor_session(b.camp_id, b.session_id)
    or exists (select 1 from public.staff s where s.camp_id = b.camp_id and s.email = public.my_email() and s.role = 'counselor' and s.bunk_id = p_bunk))
  then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select c.id, c.first_name, c.last_name, c.grade, h.alert
  from public.bunk_assignments ba join public.campers c on c.id = ba.camper_id
  left join public.camper_health h on h.camper_id = c.id
  where ba.bunk_id = p_bunk and c.active
  order by c.last_name, c.first_name;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Server only (family portal, reminders, SFSP app). Not callable from the browser.
-- ---------------------------------------------------------------------------------------------------------------

-- Everything a family's portal page shows.
create or replace function public.portal_view(p_family uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'family', jsonb_build_object('id', f.id, 'last_name', f.last_name, 'father', f.father_first, 'mother', f.mother_first),
    'camp', jsonb_build_object('name', cp.name, 'deadline', cp.settings ->> 'deadline', 'phone', cp.settings ->> 'phone', 'email', cp.settings ->> 'reply_to'),
    'family_requirements', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'label', r.label, 'help', r.help, 'kind', r.kind, 'config', r.config,
        'status', public.status_for(r.id, f.id, null),
        'reason', (select s.reject_reason from public.submissions s where s.requirement_id = r.id and s.family_id = f.id and s.camper_id is null order by s.created_at desc limit 1))
        order by r.sort)
      from public.requirements r where r.camp_id = f.camp_id and r.active and r.scope = 'family'), '[]'::jsonb),
    'campers', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
        'requirements', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'label', r.label, 'help', r.help, 'kind', r.kind, 'config', r.config,
            'status', public.status_for(r.id, f.id, c.id),
            'reason', (select s.reject_reason from public.submissions s where s.requirement_id = r.id and s.camper_id = c.id order by s.created_at desc limit 1))
            order by r.sort), '[]'::jsonb)
          from public.requirements r where r.camp_id = f.camp_id and r.active and r.scope = 'camper'))
        order by c.first_name)
      from public.campers c where c.family_id = f.id and c.active), '[]'::jsonb))
  from public.families f join public.camps cp on cp.id = f.camp_id
  where f.id = p_family
$$;

-- For reminders: every active family with what's still missing (rejected counts as missing).
create or replace function public.families_missing(p_camp uuid)
returns table (family_id uuid, last_name text, emails text[], items jsonb, missing int, welcome_sent_at timestamptz,
               paused_until date, last_reminder timestamptz)
language sql stable security definer set search_path = public as $$
  with fam as (
    select f.* from public.families f where f.camp_id = p_camp and f.active
      and exists (select 1 from public.campers c where c.family_id = f.id and c.active)
  ), items as (
    select fam.id as family_id, jsonb_build_object('camper', null, 'key', r.key, 'label', r.label, 'status', public.status_for(r.id, fam.id, null)) as item, r.sort, '' as who
      from fam join public.requirements r on r.camp_id = p_camp and r.active and r.scope = 'family'
    union all
    select fam.id, jsonb_build_object('camper', c.first_name, 'key', r.key, 'label', r.label, 'status', public.status_for(r.id, fam.id, c.id)), r.sort, c.first_name
      from fam join public.campers c on c.family_id = fam.id and c.active
      join public.requirements r on r.camp_id = p_camp and r.active and r.scope = 'camper'
  )
  select fam.id, fam.last_name,
    array_remove(array[fam.father_email, fam.mother_email], null),
    coalesce((select jsonb_agg(i.item order by i.who, i.sort) from items i where i.family_id = fam.id and i.item ->> 'status' in ('missing', 'rejected')), '[]'::jsonb),
    (select count(*)::int from items i where i.family_id = fam.id and i.item ->> 'status' in ('missing', 'rejected')),
    fam.welcome_sent_at, fam.reminders_paused_until,
    (select max(l.sent_at) from public.reminder_log l where l.family_id = fam.id and l.kind in ('reminder', 'welcome', 'manual') and l.error is null)
  from fam
$$;

-- For the SFSP app's automatic matching: who each household is (names, phones, address). No health or money.
create or replace function public.sfsp_households(p_camp uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'household', f.external_id,
    'lastName', f.last_name,
    'parents', array_remove(array[f.father_first, f.mother_first], null),
    'children', array(select c.first_name from public.campers c where c.family_id = f.id and c.active order by c.first_name),
    'phones', array_remove(array[nullif(regexp_replace(coalesce(f.father_phone, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(f.mother_phone, ''), '\D', '', 'g'), '')], null),
    'emails', array_remove(array[f.father_email, f.mother_email], null),
    'street', f.address, 'zip', f.zip) order by f.last_name), '[]'::jsonb)
  from public.families f where f.camp_id = p_camp and f.active
$$;

revoke execute on function public.portal_view(uuid) from public, anon, authenticated;
revoke execute on function public.families_missing(uuid) from public, anon, authenticated;
revoke execute on function public.sfsp_households(uuid) from public, anon, authenticated;
grant execute on function public.portal_view(uuid) to service_role;
grant execute on function public.families_missing(uuid) to service_role;
grant execute on function public.sfsp_households(uuid) to service_role;
revoke execute on function public.status_for(uuid, uuid, uuid) from authenticated;
grant execute on function public.status_for(uuid, uuid, uuid) to service_role;
