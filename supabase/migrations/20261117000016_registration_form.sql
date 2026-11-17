-- Registration form settings: the camp's own questions, which standard questions are asked or required,
-- payment plans (paid through the camp's own payment page), and whether applications need approval.
-- Camper questions become camper details (Roster, reports, Who can see what); family answers and the payment plan
-- are kept with the family.

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
    'approval', coalesce((r ->> 'approval')::boolean, true),
    'contact', c.settings ->> 'reply_to',
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.starts_on nulls last, s.name)
       from public.sessions s where s.camp_id = c.id and (r -> 'sessions' is null or r -> 'sessions' ? s.id::text)), '[]'::jsonb))
  from public.camps c, lateral (select c.settings -> 'registration' -> p_kind as r) x
  where c.slug = p_slug and p_kind in ('camper', 'staff')
$$;

create or replace function public.set_registration(p_camp uuid, p_kind text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; f jsonb; q jsonb; plans jsonb;
begin
  if not public.can(p_camp, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('camper', 'staff') then raise exception 'bad kind'; end if;
  if length(p_settings::text) > 100000 then raise exception 'Too much text'; end if;
  -- The camp's own questions: tidy, with safe ids.
  f := jsonb_build_object(
    'builtin', case when jsonb_typeof(p_settings #> '{form,builtin}') = 'object' then p_settings #> '{form,builtin}' else '{}'::jsonb end,
    'custom', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', e ->> 'id', 'section', e ->> 'section', 'label', left(trim(e ->> 'label'), 200), 'type', e ->> 'type',
        'options', case when jsonb_typeof(e -> 'options') = 'array' then e -> 'options' end,
        'required', coalesce((e ->> 'required')::boolean, false), 'help', left(nullif(trim(e ->> 'help'), ''), 500))) order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_settings #> '{form,custom}') = 'array' then p_settings #> '{form,custom}' else '[]'::jsonb end) with ordinality as t(e, n)
      where e ->> 'id' ~ '^[a-z0-9]{4,24}$' and coalesce(trim(e ->> 'label'), '') <> ''
        and e ->> 'section' in ('family', 'parents', 'emergency', 'camper', 'other')
        and e ->> 'type' in ('text', 'long', 'yesno', 'choice', 'multi', 'date', 'number')), '[]'::jsonb));
  plans := coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', e ->> 'id', 'name', left(trim(e ->> 'name'), 120),
        'description', left(nullif(trim(e ->> 'description'), ''), 1000),
        'link', case when e ->> 'link' ~ '^https://[^\s<>"]+$' then left(e ->> 'link', 500) end)) order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_settings #> '{payment,plans}') = 'array' then p_settings #> '{payment,plans}' else '[]'::jsonb end) with ordinality as t(e, n)
      where e ->> 'id' ~ '^[a-z0-9]{4,24}$' and coalesce(trim(e ->> 'name'), '') <> ''), '[]'::jsonb);
  v := jsonb_strip_nulls(jsonb_build_object(
    'enabled', coalesce((p_settings ->> 'enabled')::boolean, false),
    'opens_on', (nullif(p_settings ->> 'opens_on', '')::date)::text,
    'closes_on', (nullif(p_settings ->> 'closes_on', '')::date)::text,
    'sessions', case when jsonb_typeof(p_settings -> 'sessions') = 'array' then p_settings -> 'sessions' end,
    'intro', left(nullif(trim(p_settings ->> 'intro'), ''), 4000),
    'agreement', left(nullif(trim(p_settings ->> 'agreement'), ''), 20000),
    'approval', coalesce((p_settings ->> 'approval')::boolean, true),
    'form', f,
    'payment', jsonb_build_object('plans', plans, 'show', case when p_settings #>> '{payment,show}' = 'after_send' then 'after_send' else 'after_accept' end)));
  update public.camps set settings = jsonb_set(coalesce(settings, '{}'), '{registration}', coalesce(settings -> 'registration', '{}') || jsonb_build_object(p_kind, v)) where id = p_camp;
  -- Each camper question is a camper detail: on the Roster, in reports, in Who can see what (office and directors by default).
  if p_kind = 'camper' then
    for q in select * from jsonb_array_elements(f -> 'custom') loop
      continue when q ->> 'section' <> 'camper';
      insert into public.perm_items (camp_id, key, label, help, kind, sort)
      values (p_camp, 'f_reg_' || (q ->> 'id'), left(q ->> 'label', 80), 'Asked on the registration form', 'field', 200)
      on conflict (camp_id, key) do update set label = excluded.label;
      insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
      select p_camp, 'office', 'f_reg_' || (q ->> 'id'), true, true where exists (select 1 from public.roles where camp_id = p_camp and key = 'office')
      on conflict do nothing;
    end loop;
  end if;
  return v;
end $$;

-- Accepting, shared by the office's Accept button and camps that accept without review.
create or replace function public.accept_application_as(p_id uuid, p_family uuid, p_by text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.applications; d jsonb; fam uuid; k jsonb; cid uuid; sid text; form jsonb; q jsonb; ans jsonb; extra jsonb := '{}'::jsonb; val text;
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
    extra := extra || jsonb_build_object(q ->> 'label', case when jsonb_typeof(ans) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(ans) x) else ans #>> '{}' end);
  end loop;
  if coalesce(d ->> 'payment_plan_name', '') <> '' then extra := extra || jsonb_build_object('Payment plan', d ->> 'payment_plan_name'); end if;
  if coalesce(d ->> 'notes', '') <> '' then extra := extra || jsonb_build_object('Registration notes', left(d ->> 'notes', 2000)); end if;
  if p_family is not null then
    select id into fam from public.families where id = p_family and camp_id = a.camp_id;
    if fam is null then raise exception 'Family not found'; end if;
    update public.families set disclosures = coalesce(disclosures, '{}') || extra where id = fam;
  else
    insert into public.families (camp_id, external_id, last_name, father_title, father_first, father_phone, father_email, father_occupation,
      mother_title, mother_first, mother_phone, mother_email, mother_occupation, maiden_name, address, city, state, zip, emergency_contacts, applied_at, disclosures)
    values (a.camp_id, 'online:' || a.id, trim(coalesce(d ->> 'last_name', '')),
      nullif(d #>> '{father,title}', ''), nullif(d #>> '{father,first}', ''), nullif(d #>> '{father,phone}', ''), lower(nullif(d #>> '{father,email}', '')), nullif(d #>> '{father,occupation}', ''),
      nullif(d #>> '{mother,title}', ''), nullif(d #>> '{mother,first}', ''), nullif(d #>> '{mother,phone}', ''), lower(nullif(d #>> '{mother,email}', '')), nullif(d #>> '{mother,occupation}', ''),
      nullif(d #>> '{mother,maiden}', ''), nullif(d ->> 'address', ''), nullif(d ->> 'city', ''), nullif(d ->> 'state', ''), nullif(d ->> 'zip', ''),
      coalesce((select array_agg(concat_ws(', ', nullif(e ->> 'name', ''), nullif(e ->> 'relation', ''), nullif(e ->> 'phone', ''))) from jsonb_array_elements(coalesce(d -> 'emergency', '[]')) e where coalesce(e ->> 'name', '') <> ''), '{}'),
      a.submitted_at, extra)
    returning id into fam;
  end if;
  for k in select * from jsonb_array_elements(coalesce(d -> 'campers', '[]')) loop
    insert into public.campers (camp_id, family_id, first_name, last_name, date_of_birth, gender, grade, hebrew_name)
    values (a.camp_id, fam, trim(k ->> 'first'), coalesce(nullif(trim(k ->> 'last'), ''), trim(coalesce(d ->> 'last_name', ''))),
      nullif(k ->> 'dob', '')::date, nullif(k ->> 'gender', ''), nullif(k ->> 'grade', ''), nullif(k ->> 'hebrew_name', ''))
    returning id into cid;
    for sid in select jsonb_array_elements_text(coalesce(k -> 'sessions', '[]')) loop
      insert into public.enrollments (camper_id, session_id, camp_id)
      select cid, s.id, a.camp_id from public.sessions s where s.id::text = sid and s.camp_id = a.camp_id on conflict do nothing;
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
revoke execute on function public.accept_application_as(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.accept_application(p_id uuid, p_family uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_id;
  if a.id is null or not public.can(a.camp_id, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  return public.accept_application_as(p_id, p_family, public.my_email());
end $$;

-- Camps that don't review applications: accept as soon as one is sent. A family already in the roster with the
-- same email gets the new campers; otherwise it's a new family.
create or replace function public.applications_auto_accept() returns trigger
language plpgsql security definer set search_path = public as $$
declare fams uuid[];
begin
  if new.status = 'submitted' and old.status = 'draft' and new.kind = 'camper'
     and not coalesce((select (settings #>> '{registration,camper,approval}')::boolean from public.camps where id = new.camp_id), true) then
    select array_agg(f.id) into fams from public.families f
    where f.camp_id = new.camp_id and f.active and (lower(f.father_email) = new.email or lower(f.mother_email) = new.email);
    perform public.accept_application_as(new.id, case when array_length(fams, 1) = 1 then fams[1] end, 'automatic (no review)');
  end if;
  return null;
end $$;
create trigger applications_auto_accept after update on public.applications for each row execute function public.applications_auto_accept();
