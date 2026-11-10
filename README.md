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

| Role | Sees | Can change |
|---|---|---|
| Director | Everything | Everything, including staff access and settings |
| Office | Families, campers, form status, contacts; can open forms | Families, reminders, paper forms, imports |
| Finance | Families and money | Nothing this season (Camp Flow copy) |
| Infirmary | Campers, health forms, medical history | Approve or send back forms, paper forms, counselor alerts |
| Head counselor | Bunk lists for their session, with alerts | Bunks in their session |
| Counselor | Their own bunk list, with alerts | Nothing |

Counselors see the infirmary's one-line alert (for example "Peanut allergy, EpiPen"), never the forms. Every opening of a form file is logged.

## Tests

```
npm test                         # unit tests + database role tests (needs PostgreSQL installed locally)
node tests/browser/check.mjs     # opens every page in Chrome with made-up data (needs Playwright)
```

`tests/fixtures/make_fixtures.py` builds the made-up Camp Flow reports the tests use. Never commit a real report.

## Changing things

Ask Claude in a session with this repository. Work goes to the `staging` branch; it reaches the live site when you say "publish" (a merge to `main`). Pushing to `main` runs the tests, then updates the Supabase database and functions; Netlify republishes the website.
