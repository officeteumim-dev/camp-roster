-- Daily registration report: who registered since the last report, kept in the app and emailed at 8 a.m.

-- Camp Flow's "Applied date" is New York time; earlier imports stored it as if it were UTC. Correct those once.
-- (The import now converts it properly.)
update public.families set applied_at = (applied_at at time zone 'UTC') at time zone 'America/New_York' where applied_at is not null;

-- A "Daily registration report" item in the who-sees-what table: directors always, office by default.
create or replace function public.seed_report_permission(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perm_items (camp_id, key, label, help, kind, sort)
  values (p_camp, 'reports', 'Daily registration report', 'New registrations each morning, and who it is emailed to', 'builtin', 11)
  on conflict do nothing;
  insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
  select p_camp, 'office', 'reports', true, false where exists (select 1 from public.roles where camp_id = p_camp and key = 'office')
  on conflict do nothing;
end $$;
select public.seed_report_permission(id) from public.camps;
create or replace function public.seed_report_permission_trigger() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform public.seed_report_permission(new.id); return new; end $$;
create trigger camps_seed_report after insert on public.camps for each row execute function public.seed_report_permission_trigger();

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  report_date date not null,              -- the local date it was sent
  period_start timestamptz not null,
  period_end timestamptz not null,
  data jsonb not null,
  sent_to text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  unique (camp_id, report_date)
);
alter table public.daily_reports enable row level security;
grant select on public.daily_reports to authenticated;
grant all on public.daily_reports to service_role;
create policy reports_read on public.daily_reports for select to authenticated using (public.can(camp_id, 'reports', 'see'));

-- Families and campers first added to the app in [p_from, p_to): a family appears in exactly one report.
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
        'campers', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', trim(c.first_name || ' ' || c.last_name), 'grade', c.grade,
                       'gender', c.gender, 'dob', c.date_of_birth, 'hebrew_name', c.hebrew_name, 'staff_child', c.staff_child,
                       'sessions', coalesce((select jsonb_agg(s.name order by s.starts_on nulls last) from public.enrollments e join public.sessions s on s.id = e.session_id where e.camper_id = c.id), '[]'::jsonb),
                       'fields', coalesce((select jsonb_object_agg(cf.item_key, cf.value) from public.camper_fields cf where cf.camper_id = c.id and cf.value is not null), '{}'::jsonb))
                     order by c.first_name) from new_c c where c.family_id = f.id)) as row
      from fams f) t), '[]'::jsonb))
$$;
revoke execute on function public.registration_report(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.registration_report(uuid, timestamptz, timestamptz) to service_role;

-- "So far since the last report", for the Reports tab.
create or replace function public.registration_preview(p_camp uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz;
begin
  if not public.can(p_camp, 'reports', 'see') then raise exception 'not allowed' using errcode = '42501'; end if;
  select max(period_end) into since from public.daily_reports where camp_id = p_camp;
  return public.registration_report(p_camp, coalesce(since, now() - interval '24 hours'), now());
end $$;
grant execute on function public.registration_preview(uuid) to authenticated, service_role;
grant execute on function public.seed_report_permission(uuid) to service_role;

-- Run the report check every hour; the server sends it at 8 a.m. in each camp's time zone (not on Saturdays).
-- Reuses the address and key of the daily email job set up in supabase/setup/first-time.sql.
do $$
declare cmd text;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select command into cmd from cron.job where jobname = 'daily-family-emails';
    if cmd is not null and position('"action":"daily"' in cmd) > 0 then
      if exists (select 1 from cron.job where jobname = 'daily-registration-report') then perform cron.unschedule('daily-registration-report'); end if;
      perform cron.schedule('daily-registration-report', '1 * * * *', replace(cmd, '"action":"daily"', '"action":"daily_report"'));
    end if;
  end if;
end $$;
