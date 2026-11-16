# Camp roster

Camp Teumim's roster and forms app: families and campers imported from Camp Flow, a private forms page for each family, a missing-forms dashboard, automatic reminder emails, bunk lists, and staff logins where each role sees only what it needs. Built so it can later take over registration and payments from Camp Flow, and so other camps can use the same installation.

For where setup stands, see `SETUP-STATUS.md`.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Staff app (`web/index.html`, `web/app.js`) | Netlify | Forms dashboard, camper records, form review, bunks, money (read-only), imports, settings, activity log |
| Family portal (`web/portal.html`, `web/portal.js`) | Netlify | Each family's private page: upload health forms, sign consent, medical history, link to the SFSP form |
| Database (`supabase/migrations`) | Supabase | All records; row-level security enforces every role |
| Server functions (`supabase/functions`) | Supabase | `import-campflow` (Camp Flow reports), `portal` (family page), `sfsp` (SFSP app connection), `notify` (emails) |
| Gmail script (`apps-script/CampflowImport.gs`) | Google Apps Script, office Gmail | Picks up Camp Flow's scheduled report emails every hour and sends the download link to the import |
| Emails | Resend | Welcome emails, reminders, "please send again" |

## Who sees what

Directors set this in **Settings → Who can see what**: a table of roles × items with **See** and **Change** ticks, where they can also add roles (whole camp, one session or one bunk) and their own camper details (like T-shirt size). The database reads that table for every request (`can()`, `can_camper()`, `can_family()`, `can_bunk()` in `supabase/migrations/20261116000008_permissions.sql`), so the app can't show more than it allows. The Director always has full access, and staff access and settings stay director-only. The defaults:

| Role | Sees | Can change |
|---|---|---|
| Director | Everything | Everything, including staff access and settings |
| Office | Families, campers, form status, contacts; can open forms | Families, reminders, paper forms, imports |
| Finance | Families and money | Nothing this season (Camp Flow copy) |
| Infirmary | Campers, health forms, medical history | Approve or send back forms, paper forms, counselor alerts |
| Head counselor | Bunk lists for their session, with alerts | Bunks in their session |
| Counselor | Their own bunk list, with alerts | Nothing |

Counselors see the infirmary's one-line alert (for example "Peanut allergy, EpiPen"), never the forms. Every opening of a form file is logged.

## Daily registration report

Every day at 8:00 a.m. camp time except Saturday, `notify` (action `daily_report`, run hourly by the `daily-registration-report` pg_cron job) lists the campers first added to the app since the previous report (Sunday's covers Friday 8:00 to Sunday 8:00), saves it in `daily_reports` and emails it. Directors set the recipients (blank = the directors), the on/off switch and the columns in Settings → Daily registration report; the columns are listed in both `supabase/functions/_shared/reports.js` and `web/app.js` (a test checks they match). The Reports tab shows past reports and what's come in so far; who sees it is the "Daily registration report" row in Who can see what (office by default).

## Camp Test Site

Every signed-in person sees **Camp Test Site** in the camp list, as its director, and people with no camp yet are offered it. It's a practice camp with the same 500 campers and families as the SFSP app's Camp Test Site (`web/demo-seed.js` copies its generator; `tests/demo-seed.test.mjs` checks them against the SFSP app's own code). It never touches the database: everything is built in the browser (`web/demo-db.js`) and changes stay in that tab only until the person opens a real camp, signs out or taps **Start over**. A banner says so on every page. Emails, imports and file downloads are turned off there. "Open family page (practice)" shows what a family sees; forms sent from it appear in the test camp, and its SFSP button opens the SFSP app's practice form (`wgcamps.com/apply.html?demo=1`).

When adding a feature, add its sample records to `build()` in `web/demo-db.js`, and any new database call to the stand-in there.

## Tests

```
npm test                         # unit tests + database role tests (needs PostgreSQL installed locally)
node tests/browser/check.mjs     # opens every page in Chrome with made-up data, and walks through Camp Test Site (needs Playwright)
```

`tests/fixtures/make_fixtures.py` builds the made-up Camp Flow reports the tests use. Never commit a real report.

## Changing things

Ask Claude in a session with this repository. Work goes to the `staging` branch; it reaches the live site when you say "publish" (a merge to `main`). Pushing to `main` runs the tests, then updates the Supabase database and functions; Netlify republishes the website.
