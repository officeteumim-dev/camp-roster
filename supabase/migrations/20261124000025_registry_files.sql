-- Registry check records: the DCJS results letter (on the list that was sent) and NSOPW results screenshots (on each check).
-- Each entry: {path, name, at, by}. Files live in the private registry-results bucket (see ..._026_registry_storage.sql).
alter table public.staff_checks add column files jsonb not null default '[]'::jsonb;
alter table public.staff_check_batches add column files jsonb not null default '[]'::jsonb;

-- File paths: <camp id>/<season>/<file>.
create or replace function public.registry_file_ok(p_name text, p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' and public.can(split_part(p_name, '/', 1)::uuid, 'registry_checks', p_mode)
$$;
grant execute on function public.registry_file_ok(text, text) to authenticated;
