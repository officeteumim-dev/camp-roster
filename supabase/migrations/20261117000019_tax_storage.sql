-- Private bucket for staff tax forms (Supabase only; skipped by the local database tests).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tax-forms', 'tax-forms', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy tax_read on storage.objects for select to authenticated using (bucket_id = 'tax-forms' and public.tax_read_ok(name));
create policy tax_upload on storage.objects for insert to authenticated with check (bucket_id = 'tax-forms' and public.tax_upload_ok(name));
create policy tax_delete on storage.objects for delete to authenticated using (bucket_id = 'tax-forms' and public.tax_upload_ok(name));
