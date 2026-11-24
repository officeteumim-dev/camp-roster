-- NYS and national sex offender registry checks for staff (NY Public Health Law: before the first day of work and
-- every year before arrival). One row per staff member, registry and season; past seasons are kept.
create table public.staff_check_batches (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  season integer not null check (season between 2000 and 2100),
  kind text not null default 'nys' check (kind in ('nys')),
  sent_on date not null default current_date,
  sent_by text,
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now()
);
create table public.staff_checks (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps on delete cascade,
  staff_member_id uuid not null references public.staff_members on delete cascade,
  kind text not null check (kind in ('nys', 'national')),
  season integer not null check (season between 2000 and 2100),
  status text not null check (status in ('sent', 'clear', 'possible_match')),
  batch_id uuid references public.staff_check_batches on delete set null,
  checked_on date not null default current_date,
  checked_by text,
  note text check (length(note) <= 2000),
  updated_at timestamptz not null default now(),
  unique (staff_member_id, kind, season)
);
create index staff_checks_camp on public.staff_checks (camp_id, season, kind);
alter table public.staff_checks enable row level security;
alter table public.staff_check_batches enable row level security;
grant select, insert, update, delete on public.staff_checks, public.staff_check_batches to authenticated;
grant all on public.staff_checks, public.staff_check_batches to service_role;

-- "Staff registry checks" in Who can see what: directors always, office by default.
create or replace function public.seed_registry_permission(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perm_items (camp_id, key, label, help, kind, sort)
  values (p_camp, 'registry_checks', 'Staff registry checks', 'NYS and national sex offender registry checks for staff. Change: record checks and results', 'builtin', 15)
  on conflict do nothing;
  insert into public.permissions (camp_id, role_key, item_key, can_see, can_change)
  select p_camp, 'office', 'registry_checks', true, true where exists (select 1 from public.roles where camp_id = p_camp and key = 'office')
  on conflict do nothing;
end $$;
select public.seed_registry_permission(id) from public.camps;
create or replace function public.seed_registry_permission_trigger() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform public.seed_registry_permission(new.id); return new; end $$;
create trigger camps_seed_zz_registry after insert on public.camps for each row execute function public.seed_registry_permission_trigger();
grant execute on function public.seed_registry_permission(uuid) to service_role;

create policy staff_checks_read on public.staff_checks for select to authenticated using (public.can(camp_id, 'registry_checks', 'see'));
create policy staff_checks_write on public.staff_checks for all to authenticated using (public.can(camp_id, 'registry_checks', 'change')) with check (public.can(camp_id, 'registry_checks', 'change'));
create policy staff_check_batches_read on public.staff_check_batches for select to authenticated using (public.can(camp_id, 'registry_checks', 'see'));
create policy staff_check_batches_write on public.staff_check_batches for all to authenticated using (public.can(camp_id, 'registry_checks', 'change')) with check (public.can(camp_id, 'registry_checks', 'change'));

-- A check's staff member must be in the same camp.
create or replace function public.staff_checks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.staff_members where id = new.staff_member_id and camp_id = new.camp_id) then raise exception 'That staff member is not in this camp.'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger staff_checks_guard before insert or update on public.staff_checks for each row execute function public.staff_checks_guard();
