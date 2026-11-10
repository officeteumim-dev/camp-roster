-- Private bucket for uploaded forms. Paths: <camp_id>/<family_id>/<submission or batch>/<file>.
-- Families never touch storage directly: the portal function hands them one-time upload links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forms', 'forms', false, 15728640,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.forms_camp(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;

create policy forms_read on storage.objects for select to authenticated
  using (bucket_id = 'forms' and public.has_role(public.forms_camp(name), '{director,office,infirmary}'));
create policy forms_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'forms' and public.has_role(public.forms_camp(name), '{director,office,infirmary}'));
create policy forms_delete on storage.objects for delete to authenticated
  using (bucket_id = 'forms' and public.has_role(public.forms_camp(name), '{director}'));
