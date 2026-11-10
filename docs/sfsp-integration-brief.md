# SFSP app change: link eligibility forms to families in the camp roster app

Paste this into the Claude session that edits `officeteumim-dev/sfsp-wgroup`.

## Goal

Camp Teumim is building a separate **roster app** (Supabase) that tracks which required forms each family has turned in. It needs to know one thing from the SFSP app: **"this household has submitted an SFSP eligibility form."** Nothing else. No names, answers, income, signatures or eligibility results ever leave the SFSP app.

The roster app will email each family a personal link to the SFSP form. When the family submits, the SFSP app tells the roster app "received" for that household, so the roster app can tick the box and stop sending reminders.

The integration is **off unless a camp turns it on**. Camps that don't use it see no change.

## Ground rules

- Keep the existing end-to-end encryption exactly as it is. The only new readable field on an application is an opaque household reference (an ID number, no name).
- Follow `SETUP-STATUS.md`: commit to `staging`; publish to `main` only when the user says "publish."
- Add tests alongside the existing ones (`tests/functions.test.mjs`, `tests/app.test.mjs`, rules tests).
- Remind the user to republish `firestore.rules` in Firebase after the change.

## 1. The personal link

Format:

```
https://www.wgcamps.com/apply.html?c=CAMP_ID&r=REF
```

`REF` is created by the roster app, not the SFSP app:

```
REF = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, base64url(JSON payload)))
payload = { "v": 1, "h": "campflow:12345" }
```

- `h` is the household ID (for now, `campflow:` plus Camp Flow's family number; later the roster app may issue its own IDs, so treat it as an opaque string up to 100 characters, `[A-Za-z0-9:_-]`).
- `secret` is a per-camp shared secret (see section 4).
- **No names or other personal data in the payload.** It's stored unencrypted, so it must not undo the form's encryption.

## 2. `apply.html` (parent form)

- Read `r` from the URL. Keep it only if it matches `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` and is under 700 characters; otherwise ignore it silently. The form must work exactly as today with no `r` or a bad `r`.
- The browser can't verify the signature (it doesn't have the secret), so don't try. Don't show anything to the family about the link.
- In `submit()`, add `ref: r` to the document passed to `db.collection('camps/' + CAMP_ID + '/applications').add({...})` when `r` is present.

## 3. `firestore.rules`

In `match /applications/{id}`, the public `allow create` rule:

- Change `hasOnly(['enc', 'sessions', 'submittedAt', 'v'])` to also allow `'ref'`.
- Add: `&& (!('ref' in request.resource.data) || (request.resource.data.ref is string && request.resource.data.ref.size() < 700 && request.resource.data.ref.matches('^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$')))`

New collection `camps/{camp}/integration/{appId}` (written only by Cloud Functions):

- `allow read: if isEligAdmin(camp); allow write: if false;`
- Add `'integration'` to the excluded list in the catch-all `match /{collection}/{doc}` rule (both the read and write lines).

New top-level `integrations/{camp}` (holds the endpoint and secret): `allow read, write: if false;` (server only).

## 4. Settings: turning it on (camp admins)

Add a callable function `setRosterIntegration` (camp admins only, same admin check as the other admin callables):

- Input: `{ camp, enabled, endpoint, secret? }`. `endpoint` must be `https://`. `secret` is write-only: if it's omitted, keep the existing one. If none exists yet, generate a random 32-byte secret and return it **once** so the admin can paste it into the roster app.
- Stores `{ enabled, endpoint, secret, updatedBy, updatedAt }` in `integrations/{camp}`, and writes a readable summary (`enabled`, `endpoint`, `lastSyncAt`, `lastError`, no secret) to `camps/{camp}/private/integration` for the Settings screen.

UI in **Settings** (camp admins only), a small "Roster app connection" card:
- On/off switch, endpoint URL field, "Create new secret" button (shows the secret once with a copy button), "Send test" button.
- For Camp Teumim the endpoint is `https://<roster project>.supabase.co/functions/v1/sfsp` (the roster app shows the exact address in its Settings). The roster app needs three things pasted into its own Settings: the SFSP camp ID, the parent form address (`https://www.wgcamps.com/apply.html`) and the secret.
- Shows the last successful sync time and last error.

## 5. Cloud Functions (`functions/index.js`)

**`onApplicationWritten`**: `onDocumentWritten` on `camps/{camp}/applications/{id}`:

1. Skip if the camp's integration isn't enabled.
2. Work out the household:
   - `householdManual` (set by an admin, see section 6) wins if present; it's trusted.
   - Otherwise, if `ref` is present, verify its HMAC with the camp's secret (constant-time compare). If it's valid, use payload `h`. If not, record `status: 'unverified'` in `camps/{camp}/integration/{id}` and stop.
3. Write `camps/{camp}/integration/{id}`: `{ household, state: 'received' | 'removed', pending: true, attempts, lastError, updatedAt }`.
   - Created or updated with a household → `received`. Deleted, or household removed or changed → send `removed` for the old household (and `received` for the new one).
4. Try to send immediately (below). On success set `pending: false`, `sentAt`.

**Sending**: `POST {endpoint}` with JSON body (`camp` is the SFSP app's own camp ID; the roster app uses it to find the shared secret):

```json
{ "type": "sfsp.form", "camp": "CAMP_ID", "household": "campflow:12345",
  "form": "APPLICATION_DOC_ID", "state": "received", "at": "2026-11-10T19:00:00Z" }
```

Headers: `X-WG-Timestamp: <unix seconds>` and `X-WG-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + rawBody)>`. 10-second timeout. Any 2xx is success.

- **Never** include result, override, `signed`, `official`, sessions, or anything decrypted.
- The form ID is the opaque Firestore ID. The roster app counts a household as "received" if it has at least one `received` form.

**Retries**: in `hourlyJobs`, resend `integration` entries with `pending: true` (backoff; give up after ~48 attempts and leave `lastError` for the Settings card).

**Nightly check**: in `dailyJobs`, for each camp with the integration on, send one `{ "type": "sfsp.snapshot", "camp": ..., "households": [...], "at": ... }` listing every household with a `received` form. The roster app uses it to fix anything a missed message left out of step.

**Test**: the "Send test" button calls a callable that sends `{ "type": "sfsp.test", "camp": ..., "at": ... }` and reports the HTTP status.

## 6. Automatic linking for forms without a personal link

Paper forms an admin imports, and forms families send from the general link (no `r`), must link to the right family **automatically**. Admins should not have to paste or type anything.

Matching has to happen in the admin's browser, because only there is the form decrypted.

**Household list from the roster app**
- New callable function `rosterHouseholds` (camp admins only). It calls `GET {endpoint}/households?camp=CAMP_ID` on the roster app, with the same two headers as section 5 computed over an empty body (`X-WG-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + ".")>`), and returns the list to the browser. The secret never leaves the server.
- Each household: `{ household: "campflow:12345", lastName, parents: [first names], children: [first names], phones: [digits only], emails, street, zip }`. Cache it in memory for the session; don't store it in Firestore.

**Matching (in `index.html`, whenever forms are decrypted: page load, import save, form edit)**
- For each form with no `ref` and no `householdManual`, score it against the household list using the decrypted form: family last name, children's first names, signer phone, signer address and zip.
- Normalize before comparing: case, punctuation, spaces, common spelling variants of Hebrew names (e.g. Yosef/Yoseph, Chaim/Haim), phone digits only.
- **Auto-link** when exactly one household matches strongly: same last name plus a phone, address or child first-name match, and no other household close behind. Save `householdManual: "campflow:12345"` and `householdMatch: "auto"` on the application, and log it with `logChange` ("Linked to family automatically"). The function in section 5 picks it up and sends "received."
- **Ask only when unsure**: if two or more households tie, or the best match is weak, show "Which family is this?" on the form with the top few candidates as one-tap choices (last name, parents, children). Never a text box. "None of these" leaves it unlinked.
- Imported paper forms go through the same matching as soon as they're saved.

**On each form in Eligibility forms**
- Show "Family: Levi (Moshe, Yosef)" when linked, with how ("from the family's link," "matched automatically," or "chosen by an admin"), or the "Which family is this?" choices when not.
- Show "Couldn't verify family link" when the function marked it `unverified`, and run the automatic match for it too.
- An admin can change a link with the same one-tap list.
- Only show these controls when the integration is on.

## 7. Tests to add

- Rules: public create with a valid `ref` passes; with an oversized or malformed `ref`, or any other extra field, fails. Clients can't read `integrations/*` or write `camps/*/integration/*`.
- Functions: valid signature → `received` sent with the correct headers; tampered `ref` → `unverified`, nothing sent; delete → `removed`; the body never contains anything beyond the listed fields; retries pick up pending entries; the integration off → nothing happens.
- Matching: a clear single match links automatically; two same-last-name families with different phones and children link to the right one; a tie shows choices and links nothing; a form already linked by `ref` is never re-matched.
- `apply.html`: form submits normally with no `r`, a bad `r`, and a good `r` (stored as `ref`).

## Not in this change

- The roster app's receiving endpoint and its `/households` list (both built separately; until they exist, leave the integration off).
- Any change to how forms are encrypted, reviewed, signed or synced to Google Drive.
