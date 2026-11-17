-- Optional limits for each division: a grade range (grades as listed on the registration form) and/or an age range
-- (age on the session's first day). The registration page only offers divisions a camper fits.
alter table public.divisions
  add column grade_min text check (length(grade_min) <= 60),
  add column grade_max text check (length(grade_max) <= 60),
  add column age_min smallint check (age_min between 0 and 99),
  add column age_max smallint check (age_max between 0 and 99),
  add constraint divisions_age_order check (age_min is null or age_max is null or age_min <= age_max);

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
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
         'divisions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', d.id, 'name', d.name, 'grade_min', d.grade_min, 'grade_max', d.grade_max, 'age_min', d.age_min, 'age_max', d.age_max)) order by d.sort, d.name) from public.divisions d where d.session_id = s.id), '[]'::jsonb)) order by s.starts_on nulls last, s.name)
       from public.sessions s where s.camp_id = c.id and (r -> 'sessions' is null or r -> 'sessions' ? s.id::text)), '[]'::jsonb))
  from public.camps c, lateral (select c.settings -> 'registration' -> p_kind as r) x
  where c.slug = p_slug and p_kind in ('camper', 'staff')
$$;



