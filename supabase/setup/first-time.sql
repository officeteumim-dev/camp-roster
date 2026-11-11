-- Run once in Supabase → SQL Editor after the first deploy. Replace the values in <angle brackets>.

-- 1. The camp and its first director.
insert into public.camps (name, slug, settings)
values ('Camp Teumim Mesivta', 'teumim', '{"deadline":"2027-06-04","reply_to":"office.teumim@gmail.com","welcome_enabled":false,"reminders_enabled":false}');
insert into public.staff (camp_id, email, role)
select id, 'office.teumim@gmail.com', 'director' from public.camps where slug = 'teumim';

-- 2. The daily email job (9:05 a.m. New York time in winter; 10:05 in summer). Uses the CRON_KEY from the setup notes.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CRON_KEY>', 'cron_key');
select cron.schedule('daily-family-emails', '5 14 * * *', $$
  select net.http_post(
    url := 'https://luyoctmorgmaupuqoiqa.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_key')),
    body := '{"action":"daily"}'::jsonb)
$$);
