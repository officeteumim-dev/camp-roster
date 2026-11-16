-- "Run report now": extra reports on demand. The 8 a.m. report is still once a day; it then covers since the latest report of either kind.
alter table public.daily_reports add column manual boolean not null default false, add column run_by text;
alter table public.daily_reports drop constraint daily_reports_camp_id_report_date_key;
create unique index daily_reports_one_scheduled on public.daily_reports (camp_id, report_date) where not manual;
