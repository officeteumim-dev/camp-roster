# Roster app ↔ SFSP by W Group: connection spec (v1)

For the Claude session building the roster app. Written as a standard any roster system could follow: nothing here is
specific to one camp. Build it multi-camp from the start: every camp has its own SFSP camp ID, secret, families and
sessions.

**Status:** Phase 1 (links + "form received" messages) is built in the SFSP app (on its test site; going live soon).
Phase 2 (pre-fill, roster sync, automatic codes) is being built now against this spec.

---

## 1. The idea

1. A parent applies to camp in the roster app and enters their children.
2. The roster app gives the parent a **personal link** to the camp's SFSP eligibility form.
3. The SFSP form **pre-fills** the parent's and children's details straight from the roster app (the parent's phone
   asks the roster app directly; W Group's server never sees this data).
4. The parent checks the details, adds income and household members, and signs. The form is encrypted on the phone.
5. The SFSP app tells the roster app **"household X handed in a form"** so it can stop sending reminders.
6. The SFSP app **reads the roster** (families, children, sessions) from the roster app, so camps that use the roster
   app don't build rosters twice. Eligibility codes are put on the right children **by child ID**, never by name.

The roster app is the source of truth for who is at camp. The SFSP app is the source of truth for eligibility. The SFSP
app never sends eligibility results, income, answers or signatures to the roster app.

## 2. IDs

| ID | Who makes it | Format | Notes |
|---|---|---|---|
| SFSP camp ID | SFSP app | e.g. `camp-teumim` | Shown in the SFSP app (Settings → Roster app connection, and in the form link `?c=`). Store it per camp. |
| Household ID | Roster app | `^[A-Za-z0-9:_-]{1,100}$` | Opaque. No names, no spaces. Example: `campflow:12345`. Must never change for a family. |
| Child ID | Roster app | `^[A-Za-z0-9:_-]{1,100}$` | Opaque, unique within the camp, never reused or changed. Example: `campflow:12345:c2`. |
| Session ID | Roster app | `^[A-Za-z0-9:_-]{1,100}$` | The roster app's own session ID. The SFSP admin maps each to an SFSP session once. |

## 3. Setup (per camp)

In the SFSP app, a camp admin opens **Settings → Roster app connection** and enters:

- **Roster app address**: one https URL on the roster app that receives messages from W Group's server and answers roster
  requests (sections 6 and 7). Example: `https://roster.example.com/api/sfsp/CAMP_KEY`.
- **Pre-fill address**: one https URL the parent's phone calls (section 5). May be the same base.

The SFSP app then shows a **shared secret** once (43 characters, base64url). The admin pastes it into the roster app.
Store it per camp, encrypted at rest, never shown back in full, never sent to the browser. If the admin makes a new
secret in the SFSP app, links signed with the old one stop being recognized: the roster app needs to re-issue links.

## 4. The personal link

```
https://www.wgcamps.com/apply.html?c=SFSP_CAMP_ID&r=REF
```

`REF` = `base64url(JSON payload)` + `.` + `base64url(HMAC-SHA256(secret, the first part as ASCII))`, no `=` padding.

Payload: `{"v":1,"h":"HOUSEHOLD_ID"}`, optionally with `"exp": <unix seconds>`.
- `exp` is honored by the **pre-fill** address (refuse after it). A form already filled in is still linked to the
  household after `exp`.
- Keep REF under 700 characters. Add nothing else to the payload: it is readable by anyone who has the link.

```js
const crypto = require('crypto');
function makeRef(householdId, secret, exp) {
  const p = { v: 1, h: householdId }; if (exp) p.exp = exp;
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
function readRef(ref, secret) { // returns { h, exp } or null
  const [body, sig] = String(ref).split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return p.v === 1 && /^[A-Za-z0-9:_-]{1,100}$/.test(p.h) ? p : null;
}
```

**Test vector.** Secret `test-secret-DO-NOT-USE-0123456789abcdef`, household `campflow:12345`:
```
eyJ2IjoxLCJoIjoiY2FtcGZsb3c6MTIzNDUifQ.1FOr6b3iMHodO-nDUruXBbRJb3xiRN36gETwh04Uy-k
```
With `exp` 1767225599:
```
eyJ2IjoxLCJoIjoiY2FtcGZsb3c6MTIzNDUiLCJleHAiOjE3NjcyMjU1OTl9.jXuQfTPons2GAs0C98VICAjzDfISS5w21LQ2ZUdb8mY
```

**When to send a link:** with the camp application confirmation, and in reminders until the household is marked
"handed in" (section 6). Don't send one to a household whose children at camp are all too old (section 9).

## 5. Pre-fill (called from the parent's phone)

```
GET {pre-fill address}?camp=SFSP_CAMP_ID&r=REF
```

- **CORS:** allow `GET` from origins `https://www.wgcamps.com`, and for testing `https://staging.wgcamps.com` and
  `https://staging--sfsp-wgroup.netlify.app` (the SFSP test site). No credentials/cookies.
- Verify REF with the camp's secret (and `exp` if present). Bad, expired or unknown → `404` with no body details.
- Return only that one household. Headers: `Content-Type: application/json`, `Cache-Control: no-store`.
- Rate-limit by IP (e.g. 30 requests/minute).
- The SFSP form waits up to 8 seconds; if this fails, the parent types everything and the SFSP app matches the form to a
  family later.

Response:
```json
{
  "household": "campflow:12345",
  "parent": {
    "firstName": "Sarah", "lastName": "Levi",
    "phone": "8455550123", "email": "sarah@example.com",
    "address": { "street": "12 Maple Ave", "apt": "", "city": "Monsey", "state": "NY", "zip": "10952" }
  },
  "children": [
    { "id": "campflow:12345:c1", "legalFirst": "Isaac", "legalLast": "Levi", "hebrewName": "Yitzchok",
      "dob": "2015-03-08", "sessions": ["sess-boys-1"] },
    { "id": "campflow:12345:c2", "legalFirst": "Rachel", "legalLast": "Levi", "hebrewName": "Rochel",
      "dob": "2006-07-20", "sessions": ["sess-girls-2"] }
  ],
  "sessions": [
    { "id": "sess-boys-1", "name": "Boys first half", "start": "2027-06-29", "end": "2027-07-23" },
    { "id": "sess-girls-2", "name": "Girls second half", "start": "2027-07-26", "end": "2027-08-18" }
  ]
}
```
- `sessions`: the sessions these children are in, with dates (`YYYY-MM-DD`). The form uses the start dates for the age
  rule (section 9) and ticks the matching SFSP sessions.
- Include only children **enrolled at camp** for this season. `dob` is `YYYY-MM-DD`. Any field may be `""` if unknown,
  except `household` and each child's `id`.
- The SFSP form fills the **legal** names (the federal record needs legal names). The parent can correct them; the child
  ID stays attached, so the roster app's names never need to match.

**Camp application fields** (roster app): ask for **"Legal name"** (first and last, as on the birth certificate) and
**"Hebrew name"** for each child, plus date of birth.

## 6. Messages W Group's server sends to the roster app address

All are `POST` with JSON and these headers:

- `X-WG-Timestamp`: unix seconds.
- `X-WG-Signature`: `sha256=` + hex(HMAC-SHA256(secret, timestamp + "." + raw body)).

Verify the signature over the **raw** body bytes with a timing-safe compare. Reject if the timestamp is more than
300 seconds from now. Answer `2xx` quickly. Anything else (or no answer in 10 s) is retried hourly for up to 48 hours.
Redirects are not followed. Handle every message idempotently (the same message can arrive twice).

```js
function verify(req, rawBody, secret) {
  const ts = req.headers['x-wg-timestamp'], sig = String(req.headers['x-wg-signature'] || '');
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex');
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
```

**`sfsp.form`**: a form changed for a household.
```json
{"type":"sfsp.form","camp":"camp-teumim","household":"campflow:12345","form":"Xy12AbCdEf34GhIjKl56","state":"received","at":"2026-11-12T18:00:00.000Z"}
```
- `state: "received"`: mark the household as handed in; stop reminders.
- `state: "removed"`: a camp admin moved this form to a different household or unlinked it. Un-mark this household
  only if no other form for it is still received (track by `form`).
- Deleting a form in the SFSP app sends nothing: the household stays handed in.

**Test vector.** Secret above, body exactly as shown, timestamp `1762970400` →
`X-WG-Signature: sha256=dfbdf1e2bfbc33a4122e6d98c917b51f9f22540bd5a9e4a400ab756516e1c411`

**`sfsp.snapshot`**: nightly, and when the connection is turned on. The full list of households with a form handed in.
Use it to fix anything out of step.
```json
{"type":"sfsp.snapshot","camp":"camp-teumim","households":["campflow:12345","campflow:12399"],"at":"..."}
```

**`sfsp.test`**: from the admin's "Send test" button. Just answer `200`.
```json
{"type":"sfsp.test","camp":"camp-teumim","at":"..."}
```

## 7. Roster requests (Phase 2)

W Group's server asks for the camp's roster nightly and when an admin taps "Sync now", by posting to the **same roster
app address**, signed as in section 6:
```json
{"type":"sfsp.roster.request","camp":"camp-teumim","at":"..."}
```
Answer `200` with the roster as the body, signed the same way so W Group knows it came from the roster app:
- `X-Roster-Timestamp`: unix seconds
- `X-Roster-Signature`: `sha256=` + hex(HMAC-SHA256(secret, timestamp + "." + raw response body))

```json
{
  "camp": "camp-teumim",
  "sessions": [
    { "id": "sess-boys-1", "name": "Boys first half", "start": "2027-06-29", "end": "2027-07-23" }
  ],
  "households": [
    { "id": "campflow:12345", "lastName": "Levi", "phone": "8455550123", "zip": "10952",
      "children": [
        { "id": "campflow:12345:c1", "legalFirst": "Isaac", "legalLast": "Levi", "hebrewName": "Yitzchok",
          "dob": "2015-03-08", "sessions": ["sess-boys-1"], "staffChild": false }
      ] }
  ]
}
```
- Every child enrolled for the season, with all of their sessions. Children who leave camp are simply left out.
- `staffChild`: true if the child's parent works at camp (the SFSP roster tracks this).
- Keep the response under 900 KB (about 3,000 children). Household-level data is limited to last name, phone and zip, used only to match paper
  forms. No emails or street addresses here.
- The SFSP admin maps each roster app session to an SFSP session once (by name and dates); unmapped sessions are flagged.

## 8. What the SFSP app does with it (for reference)

- Rosters for connected camps come from section 7 and are read-only there (names, sessions); camps without a roster app
  keep the SFSP app's own roster.
- When an admin signs a form, each child's eligibility code goes onto the roster child with the same child ID.
- Forms typed by hand (no pre-fill, general link, or paper) are matched to a family by last name, phone, zip and the
  children's names. The admin confirms every match. Forms with no match, or that can't be checked because the roster
  app was unreachable, are flagged for the admin.

## 9. Age rule

SFSP meals are for children **18 and under**. A child who is **19 or older on the first day of their session** is not
eligible.

- If **every** child a household has at camp is too old, the household doesn't need a form: don't send the link. If the
  parent opens it anyway, the SFSP form says no form is needed and asks for nothing. The SFSP app marks those children
  not eligible automatically.
- If **some** children are eligible, the parent fills in the form for those children; the older ones are marked not
  eligible automatically.

**Decided (Nov 12, 2026):** a child 19 or older is always marked not eligible automatically. A camp admin can change it
by hand in the rare case the federal exception applies (people over 18 with a mental or physical disability who take part
in a school program for people with disabilities). **Possible future change:** have the form ask one yes/no question
about this for children 19 or older.

## 10. Build checklist for the roster app

- [ ] Per camp: SFSP camp ID, roster app address key, shared secret (encrypted at rest), session list.
- [ ] Household and child IDs that never change (section 2).
- [ ] Camp application: "Legal name", "Hebrew name" and date of birth per child.
- [ ] Personal links (section 4), sent with the application confirmation and in reminders; skip households where every
      child at camp is too old (section 9).
- [ ] Pre-fill endpoint with CORS, REF check, `exp`, rate limit, `no-store` (section 5).
- [ ] Message endpoint: signature + timestamp check, idempotent `sfsp.form` / `sfsp.snapshot` / `sfsp.test` handling,
      "handed in" status per household, reminders stop when handed in (section 6).
- [ ] Roster request handling with a signed response (section 7).
- [ ] Tests using the test vectors above.
- [ ] Never log REFs, secrets or full request bodies.