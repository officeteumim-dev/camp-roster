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

## Online registration (off until a camp turns it on)

Parents apply at `/register.html?camp=<slug>`: they sign in (Google pop-up or email and password), fill in one application for the family (saved as they type), choose a payment plan if the camp has any, sign and send it. The office reviews it under **Applications**: it shows families already in the roster that match (same email, phone, or last name and father), and **Accept** adds the campers as a new family or into the matched one (existing families' details are left alone). Waiting list and Decline are there too; the family can be emailed about each decision. Camps can turn off review, and then applications are accepted as soon as they're sent.

**Applications → Set up online registration** (anyone with Applications "change"): on/off, open and close dates, review on/off, which sessions, the questions (rename, required / optional / not asked, and the camp's own questions for the family, parents, emergency contacts, each camper or "anything else"), payment plans (name, description, a link to the camp's own payment page; the "Pay now" link shows after sending or after acceptance) and the welcome and agreement text. The standard questions are listed in `web/reg-form.js`. Camper questions become camper details (`f_reg_<id>`: on the Roster, in reports, in Who can see what); family answers, the payment plan and notes are kept in the family's `disclosures`.

Each session offered online has its own link (`&session=<name as a slug>`, only that session); a session with **divisions** (Settings → Sessions; `divisions`, and `enrollments.division_id`) asks parents to choose one, and each division has its own link too (`&session=…&division=<name as a slug>`), which fixes both. Division is a Roster column and a daily report column. Settings → Sessions → "Camp Flow registrations are for" puts Camp Flow campers with no session into that session (`assign_campflow_session`, also run after each import).

**Every Camp Flow column comes in.** Families report: columns without a field of their own go to `families.extra`, disclosures to `families.disclosures` (merged, so registration answers stay), money to `finance_accounts`; their names are saved in `camps.settings.campflow_family_columns` so they're Roster and report columns. Campers report: approval status, applied and accepted dates and enrollment ID have fields on `campers`; every other camper column becomes a camper detail `cf_<column>` (created on import; office can see and change, medical ones also the infirmary), and a family missing from the app is added from the campers report's family columns. Full Name and Age are worked out from other columns.

The Camp Flow import only looks at `campflow:` families, so online families (`online:<application id>`) are never flagged as gone.

## Staff applications, staff roster and tax forms

Staff apply at `/register.html?camp=<slug>&kind=staff` (off until turned on under **Applications → Staff → Set up staff applications**). The form is written for older teens: their details, school and grade, positions (the camp's list, Lifeguard, Canteen, Kitchen staff, Waiter, Counselor, Madrich and Leagues to start), sessions, parents, emergency contact, and camp experience as a camper and as staff (or "None"); the same question builder applies (`STAFF_BUILTIN` in `web/reg-form.js`). Staff applications are always reviewed: **Hire** with the chosen positions adds them to `staff_members` (or updates a returning staff member matched by email, phone or name).

**Staff roster** (`#staffroster`, "Staff roster" in Who can see what; office by default) lists everyone working at camp, separate from app logins: search, filter by position and session, choose columns, sort, export, add by hand, edit, "No longer on staff".

**Tax forms:** a camp can ask for a W-4, a W-9, or either (the applicant chooses), with the application or after hiring. Applicants answer a short questionnaire and the app fills in and signs the official IRS form in their browser (`web/tax-fill.js` with pdf-lib, served from `web/vendor/`; blank forms in `web/irs/`, refreshed monthly by `.github/workflows/irs-forms.yml`, which refuses a new version whose fields no longer match), or they upload a form they filled in themselves. The finished PDF goes to the private `tax-forms` bucket (`<camp>/<application>/<file>`); the SSN exists only inside that PDF, never in the app's data. Only directors and roles with "Staff tax forms" (finance by default) can open them, through one-minute links. Declining an application deletes its form; hiring copies the reference to the staff record.

## Consents on the application forms

Each form shows its consents as separate sections that must each be ticked: by default "Consent to pre-employment background check" (staff; applicants under 18 also give a parent or guardian's name) and "Assumption of risk and consent to participate" (campers). Standard wording is in `web/reg-form.js` (`defaultConsents`); a camp edits, turns off or adds consents in the setup page (`settings.registration_consents.<kind>`, saved by `set_registration_consents`). What was agreed to (title, full wording, time, guardian) is saved in the application's `data.consents`.

## Staff registry checks

**Registry checks** (`#checks`; "Staff registry checks" in Who can see what, office by default) tracks the NYS and national sex offender registry checks for everyone on the staff roster, per season (`staff_checks`, one row per staff member, registry and season; `staff_check_batches` for lists sent to DCJS). NYS: tick who to send, download the spreadsheet in DCJS's format (`LastName`, `FirstName`, `Birth_Date` as MM/DD/YYYY, `SSN` left blank; written by `web/xlsx-write.js`), open a pre-written email to SORSearch@dcjs.ny.gov (subject "800 # Search"; the camp's address, phone, fax and contact are saved in `camps.settings.dcjs`), mark as sent, then record DCJS's reply for the whole list or flag a possible match. National: a name-by-name list with Copy name, a link to NSOPW, and No match / Possible match. The app does not search NSOPW itself: pasting a screenshot of the results (or Add picture) saves it to the highlighted person's check as No match and moves on. DCJS results letters are uploaded to the list they answer. Both are kept in the private `registry-results` bucket (`<camp>/<season>/<file>`, `files` on `staff_checks` / `staff_check_batches`). The DCJS email can open as a Gmail compose window (`mail.google.com/mail/?view=cm…`). Statuses show on the Staff roster and each staff member's page.

## Open to the public, by approval

Anyone can sign in (Google or an emailed link). People on a camp's staff go straight to their camp; everyone else sees a form to ask to open a camp (`camp_requests`, one waiting request per email) and, once sent, a "waiting for approval" note. Site owners (`site_admins`, seeded with office.teumim@gmail.com) get an email per request and decide under **Camp requests**: approving makes the camp with the standard forms, roles and settings and makes the requester its director; the requester is emailed either way. The switch on that page, "Let people without a camp explore Camp Test Site", is off until you're ready.

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
