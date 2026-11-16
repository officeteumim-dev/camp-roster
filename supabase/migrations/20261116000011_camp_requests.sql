-- Open to the public: anyone can sign in, but only people added to a camp get in.
-- Everyone else can ask to open a camp; the site owner approves or declines.

create table public.site_admins (email text primary key check (email = lower(email)));
insert into public.site_admins values ('office.teumim@gmail.com') on conflict do nothing;
alter table public.site_admins enable row level security;
grant all on public.site_admins to service_role;

create or replace function public.is_site_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.site_admins where email = public.my_email())
$$;

-- One row of site-wide switches.
create table public.site_settings (
  id boolean primary key default true check (id),
  public_test_camp boolean not null default false,   -- people without a camp may explore Camp Test Site
  updated_at timestamptz not null default now()
);
insert into public.site_settings default values;
alter table public.site_settings enable row level security;
grant select, update on public.site_settings to authenticated;
grant all on public.site_settings to service_role;
create policy site_settings_read on public.site_settings for select to authenticated using (true);
create policy site_settings_update on public.site_settings for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

create table public.camp_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null default public.my_email() check (email = lower(email)),
  name text not null check (length(trim(name)) between 1 and 120),
  camp_name text not null check (length(trim(camp_name)) between 2 and 120),
  location text check (length(location) <= 160),
  phone text check (length(phone) <= 40),
  campers text check (length(campers) <= 40),
  message text check (length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  camp_id uuid references public.camps on delete set null,
  decided_by text,
  decided_at timestamptz,
  notified_at timestamptz,            -- owner emailed about it
  answer_sent_at timestamptz,         -- requester emailed the decision
  created_at timestamptz not null default now()
);
create unique index camp_requests_one_pending on public.camp_requests (email) where status = 'pending';
alter table public.camp_requests enable row level security;
grant select, insert on public.camp_requests to authenticated;
grant update on public.camp_requests to authenticated;
grant all on public.camp_requests to service_role;
create policy camp_requests_read on public.camp_requests for select to authenticated using (email = public.my_email() or public.is_site_admin());
create policy camp_requests_insert on public.camp_requests for insert to authenticated
  with check (email = public.my_email() and status = 'pending' and camp_id is null and decided_by is null and notified_at is null and answer_sent_at is null);
create policy camp_requests_decide on public.camp_requests for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- What the sign-in screen needs to know about this person.
create or replace function public.site_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', public.is_site_admin(),
    'public_test_camp', coalesce((select public_test_camp from public.site_settings), false),
    'pending_requests', case when public.is_site_admin() then (select count(*) from public.camp_requests where status = 'pending') else 0 end,
    'my_request', (select to_jsonb(r) - 'notified_at' - 'answer_sent_at' - 'decided_by' from public.camp_requests r where r.email = public.my_email() order by r.created_at desc limit 1))
$$;
grant execute on function public.site_info() to authenticated;

-- Approve: makes the camp (with the standard forms, roles and settings) and makes the requester its director.
create or replace function public.approve_camp_request(p_id uuid, p_camp_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.camp_requests; v_camp uuid; v_name text; v_slug text; n int := 1;
begin
  if not public.is_site_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.camp_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request has already been decided.'; end if;
  v_name := coalesce(nullif(trim(p_camp_name), ''), trim(r.camp_name));
  v_slug := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 34);
  if length(v_slug) < 2 then v_slug := 'camp'; end if;
  while exists (select 1 from public.camps where slug = case when n = 1 then v_slug else v_slug || '-' || n end) loop n := n + 1; end loop;
  if n > 1 then v_slug := v_slug || '-' || n; end if;
  insert into public.camps (name, slug, settings) values (v_name, v_slug, jsonb_build_object('reply_to', r.email, 'welcome_enabled', false, 'reminders_enabled', false))
    returning id into v_camp;
  insert into public.staff (camp_id, email, role, name, added_by) values (v_camp, r.email, 'director', r.name, public.my_email());
  update public.camp_requests set status = 'approved', camp_id = v_camp, decided_by = public.my_email(), decided_at = now() where id = p_id;
  return v_camp;
end $$;
grant execute on function public.approve_camp_request(uuid, text) to authenticated;

create or replace function public.decline_camp_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_site_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.camp_requests set status = 'declined', decided_by = public.my_email(), decided_at = now() where id = p_id and status = 'pending';
  if not found then raise exception 'This request has already been decided.'; end if;
end $$;
grant execute on function public.decline_camp_request(uuid) to authenticated;
