-- Uploaded form files follow the who-sees-what table (Health forms).
drop policy if exists forms_read on storage.objects;
drop policy if exists forms_upload on storage.objects;
drop policy if exists forms_delete on storage.objects;
create policy forms_read on storage.objects for select to authenticated
  using (bucket_id = 'forms' and public.can(public.forms_camp(name), 'health_forms', 'see'));
create policy forms_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'forms' and public.can(public.forms_camp(name), 'health_forms', 'change'));
create policy forms_delete on storage.objects for delete to authenticated
  using (bucket_id = 'forms' and public.is_director(public.forms_camp(name)));
