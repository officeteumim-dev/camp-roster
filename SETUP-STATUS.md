# Setup status

Last updated November 10, 2026.

## Done
- Phase 1 code written and tested: database with roles, Camp Flow import, family portal, missing-forms dashboard, form review, bunks, read-only money copy, reminders, SFSP connection, activity log.
- Tested against the real November 9 Camp Flow families report (31 families, 33 campers read correctly). The report itself is not in the repository.

## To do (in order)

### 1. GitHub
- [ ] Create a private repository `officeteumim-dev/camp-roster` (empty). Claude pushes the code.

### 2. Supabase
- [ ] Create project `camp-roster` (region East US) under the office Google account; upgrade the organization to Pro.
- [ ] Send Claude the Project URL and anon public key (Project Settings → API). They go in `web/config.js`.
- [ ] Authentication → Providers: turn on **Google** (needs a Google OAuth client; Claude will walk through it) and **Email** (magic link).
- [ ] Authentication → URL Configuration: Site URL = the Netlify address; add it to Redirect URLs.

### 3. GitHub secrets (repository → Settings → Secrets and variables → Actions)
Secrets: `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access Tokens), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `RESEND_API_KEY`, `IMPORT_KEY` and `CRON_KEY` (two long random strings; Claude can generate them).
Variables: `APP_URL` (the Netlify address, e.g. `https://roster.wgcamps.com`), `MAIL_FROM` (e.g. `Camp Teumim <office@wgcamps.com>`; the `wgcamps.com` domain is already verified in Resend for the SFSP app).

### 4. First deploy and camp
- [ ] Push to `main` → the workflow creates the tables and functions.
- [ ] Run `supabase/setup/first-time.sql` in the SQL Editor (camp, first director, daily email job).

### 5. Netlify
- [ ] New site from `camp-roster`, publish directory `web` (set by `netlify.toml`). Optional: domain `roster.wgcamps.com`.

### 6. Camp Flow import
- [ ] In Camp Flow, switch the "All" families report to **daily**, and create a **campers** report (camper link, family link, first and last name, date of birth, gender, grade, sessions, bunk) and, if available, a **transactions** report; schedule both daily to the office Gmail.
- [ ] Set up `apps-script/CampflowImport.gs` (steps at the top of the file).

### 7. SFSP app (connection spec v1: `docs/sfsp-connection-spec-v1.md`, which replaces the earlier brief)
- [x] Roster side built (November 12): personal links with expiry, pre-fill address, "handed in" messages and nightly snapshot, roster sync with signed answers, age rule, legal and Hebrew names, secret kept in Supabase Vault. Tested with the spec's test vectors.
- [ ] In this app's Settings → Sessions: enter each session's start and end dates (needed for the age rule and the SFSP roster).
- [ ] In the SFSP app's Settings → Roster app connection: enter the two addresses shown in this app's Settings → SFSP app connection; copy the secret it shows.
- [ ] In this app's Settings → SFSP app connection: paste the SFSP camp ID and the secret, then press "Send test" in the SFSP app.

### 8. Before turning emails on
- [ ] Settings → set the forms deadline (currently June 4, 2027 as a placeholder), reply-to address and phone.
- [ ] Decide whether Camp Flow's "Medical Authorization" disclosure counts as consent to treat (Settings → Required forms).
- [ ] Send yourself a test: add your own family in Camp Flow or use "Copy family link" on a test family.
- [ ] Turn on welcome emails, then reminders.

## Open questions
- Does Camp Flow's Medical Authorization disclosure count as consent to treat?
- Health-record retention period for New York.
- Why the money columns in the Camp Flow families report are empty (no charges posted yet, or a report setting).
