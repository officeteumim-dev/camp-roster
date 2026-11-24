-- Private bucket for registry check records (Supabase only; skipped by the local database tests).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('registry-results', 'registry-results', false, 15728640, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy registry_read on storage.objects for select to authenticated using (bucket_id = 'registry-results' and public.registry_file_ok(name, 'see'));
create policy registry_upload on storage.objects for insert to authenticated with check (bucket_id = 'registry-results' and public.registry_file_ok(name, 'change'));
create policy registry_delete on storage.objects for delete to authenticated using (bucket_id = 'registry-results' and public.registry_file_ok(name, 'change'));
