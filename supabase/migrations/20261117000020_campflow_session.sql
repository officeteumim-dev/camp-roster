-- Which session Camp Flow registrations are for (settings.campflow_session). Camp Flow campers who aren't in any
-- session yet are put in it; Camp Flow's camper report, when it names sessions, still decides for its campers.
create or replace function public.assign_campflow_session(p_camp uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare sid uuid; n integer;
begin
  -- (current_user is this function's owner here; the 'role' setting is who is calling.)
  if coalesce(current_setting('role', true), 'none') not in ('service_role', 'none') and not public.is_director(p_camp) then raise exception 'not allowed' using errcode = '42501'; end if;
  select s.id into sid from public.sessions s join public.camps c on c.id = s.camp_id
  where c.id = p_camp and s.id::text = c.settings ->> 'campflow_session';
  if sid is null then return 0; end if;
  insert into public.enrollments (camper_id, session_id, camp_id)
  select c.id, sid, p_camp from public.campers c join public.families f on f.id = c.family_id
  where c.camp_id = p_camp and c.active and f.external_id like 'campflow:%'
    and not exists (select 1 from public.enrollments e where e.camper_id = c.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.assign_campflow_session(uuid) to authenticated, service_role;
