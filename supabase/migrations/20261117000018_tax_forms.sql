-- Staff tax forms (W-4 or W-9). Applicants upload the filled-in IRS form (it carries their SSN), so the app never
-- stores an SSN as data. Files live in their own private bucket (see ..._019_tax_storage.sql), readable only by
-- roles with "Staff tax forms" (directors always; finance by default). A declined application's form is deleted.

alter table public.staff_members add column tax_form jsonb;   -- {type, path, name, uploaded_at}

create or replace function public.seed_tax_permission(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perm_items (camp_id, key, label, help, kind, sort)
  values (p_camp, 'tax_forms', 'Staff tax forms', 'W-4 and W-9 forms staff upload (they include Social Security numbers). Change: add or remove them', 'builtin', 14)
  on conflict do nothing;
  insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
  select p_camp, 'finance', 'tax_forms', true, false where exists (select 1 from public.roles where camp_id = p_camp and key = 'finance')
  on conflict do nothing;
end $$;
select public.seed_tax_permission(id) from public.camps;
create or replace function public.seed_tax_permission_trigger() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform public.seed_tax_permission(new.id); return new; end $$;
create trigger camps_seed_zz_tax after insert on public.camps for each row execute function public.seed_tax_permission_trigger();
grant execute on function public.seed_tax_permission(uuid) to service_role;

-- File paths: <camp id>/<application id>/<file>. Who may put a file there:
-- the applicant, into their own staff application while it's a draft; or staff allowed to change tax forms.
create or replace function public.tax_upload_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.applications a
    where split_part(p_name, '/', 1) = a.camp_id::text and split_part(p_name, '/', 2) = a.id::text and a.kind = 'staff'
      and ((a.user_id = auth.uid() and a.status = 'draft') or public.can(a.camp_id, 'tax_forms', 'change'))
  )
$$;
create or replace function public.tax_read_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' and public.can(split_part(p_name, '/', 1)::uuid, 'tax_forms', 'see')
$$;
grant execute on function public.tax_upload_ok(text), public.tax_read_ok(text) to authenticated;

-- Hiring copies the tax form to the staff record.
create or replace function public.staff_tax_from_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.staff_member_id is not null and new.status = 'accepted' and new.kind = 'staff' and new.data -> 'tax_form' ->> 'path' is not null
     and (old.staff_member_id is distinct from new.staff_member_id or old.status <> 'accepted') then
    update public.staff_members set tax_form = new.data -> 'tax_form' where id = new.staff_member_id;
  end if;
  return null;
end $$;
create trigger applications_tax_to_staff after update on public.applications for each row execute function public.staff_tax_from_application();

-- The staff application settings may ask for a tax form: tax_form = none | w4 | w9 | choice; tax_when = apply | hired.
create or replace function public.set_tax_setting(p_camp uuid, p_form text, p_when text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can(p_camp, 'applications', 'change') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_form not in ('none', 'w4', 'w9', 'choice') or p_when not in ('apply', 'hired') then raise exception 'bad setting'; end if;
  update public.camps set settings = coalesce(settings, '{}') || jsonb_build_object('registration', coalesce(settings -> 'registration', '{}')
    || jsonb_build_object('staff', coalesce(settings #> '{registration,staff}', '{}') || jsonb_build_object('tax_form', p_form, 'tax_when', p_when)))
  where id = p_camp;
end $$;
grant execute on function public.set_tax_setting(uuid, text, text) to authenticated;

-- Camps that ask for the tax form after hiring: the hired applicant may upload it to their application's folder.
create or replace function public.tax_upload_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.applications a join public.camps c on c.id = a.camp_id
    where split_part(p_name, '/', 1) = a.camp_id::text and split_part(p_name, '/', 2) = a.id::text and a.kind = 'staff'
      and ((a.user_id = auth.uid() and (a.status = 'draft' or (a.status = 'accepted' and c.settings #>> '{registration,staff,tax_when}' = 'hired')))
           or public.can(a.camp_id, 'tax_forms', 'change'))
  )
$$;

-- After hiring, the applicant records the uploaded form (their application is locked otherwise).
create or replace function public.attach_tax_form(p_app uuid, p_type text, p_path text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.applications; t jsonb;
begin
  select * into a from public.applications where id = p_app;
  if a.id is null or a.user_id <> auth.uid() or a.kind <> 'staff' or a.status <> 'accepted' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_type not in ('W-4', 'W-9') or split_part(p_path, '/', 1) <> a.camp_id::text or split_part(p_path, '/', 2) <> a.id::text then raise exception 'bad file'; end if;
  t := jsonb_build_object('type', p_type, 'path', p_path, 'name', left(p_name, 200), 'uploaded_at', now());
  update public.applications set data = data || jsonb_build_object('tax_form', t) where id = p_app;
  if a.staff_member_id is not null then update public.staff_members set tax_form = t where id = a.staff_member_id; end if;
end $$;
grant execute on function public.attach_tax_form(uuid, text, text, text) to authenticated;
