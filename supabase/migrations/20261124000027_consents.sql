-- Consents on the application forms, each agreed to separately: by default a pre-employment background check consent
-- (staff) and an assumption of risk and consent to participate (campers). Kept in settings.registration_consents.<kind>
-- as [{id, title, text, enabled}]; null means "the standard ones" (web/reg-form.js). What each applicant agreed to
-- (title, full text, when, and a parent's name for staff under 18) is saved in their application.
create or replace function public.registration_consents(p_slug text, p_kind text default 'camper') returns jsonb
language sql stable security definer set search_path = public as $$
  select c.settings -> 'registration_consents' -> p_kind from public.camps c where c.slug = p_slug and p_kind in ('camper', 'staff')
$$;
grant execute on function public.registration_consents(text, text) to anon, authenticated;

create or replace function public.set_registration_consents(p_camp uuid, p_kind text, p_consents jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.can(p_camp, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('camper', 'staff') or jsonb_typeof(p_consents) <> 'array' or length(p_consents::text) > 100000 then raise exception 'bad consents'; end if;
  v := coalesce((select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'title', left(trim(e ->> 'title'), 160), 'text', left(trim(e ->> 'text'), 20000),
         'enabled', coalesce((e ->> 'enabled')::boolean, true)) order by n)
       from jsonb_array_elements(p_consents) with ordinality t(e, n)
       where e ->> 'id' ~ '^[a-z0-9_]{3,30}$' and coalesce(trim(e ->> 'title'), '') <> '' and coalesce(trim(e ->> 'text'), '') <> ''), '[]'::jsonb);
  update public.camps set settings = coalesce(settings, '{}') || jsonb_build_object('registration_consents', coalesce(settings -> 'registration_consents', '{}') || jsonb_build_object(p_kind, v)) where id = p_camp;
  return v;
end $$;
grant execute on function public.set_registration_consents(uuid, text, jsonb) to authenticated;
