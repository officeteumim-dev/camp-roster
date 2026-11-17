// Opens every page of the staff app and the family portal in Chrome with made-up data and fails on any script error.
// Run: node tests/browser/check.mjs   (needs Playwright + Chrome; screenshots go to tests/browser/out/)
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '../../web');
const out = path.join(here, 'out');
await mkdir(out, { recursive: true });

const camp = { id: 'c1', name: 'Camp Teumim Mesivta', slug: 'teumim', settings: { deadline: '2027-06-04', reply_to: 'office@example.org', welcome_enabled: true, reminders_enabled: true } };
const reqs = [
  { id: 'r1', key: 'sfsp', label: 'SFSP meal form', scope: 'family', kind: 'sfsp', active: true, config: {}, help: 'Summer Food Service Program income form' },
  { id: 'r2', key: 'insurance', label: 'Health insurance', scope: 'camper', kind: 'upload', active: true, config: { fields: [{ key: 'carrier', label: 'Insurance company' }, { key: 'member_id', label: 'Member ID' }], min_files: 1 }, help: 'Card photo' },
  { id: 'r3', key: 'physical', label: 'Physical exam', scope: 'camper', kind: 'upload', active: true, config: { min_files: 1 }, help: 'Signed by the doctor' },
  { id: 'r4', key: 'immunizations', label: 'Immunization record', scope: 'camper', kind: 'upload', active: true, config: { min_files: 1 } },
  { id: 'r5', key: 'consent', label: 'Consent to treat', scope: 'family', kind: 'consent', active: true, config: { accept_disclosure: null, text: 'I give permission…' } },
  { id: 'r6', key: 'medical_history', label: 'Medical history', scope: 'camper', kind: 'questionnaire', active: true, config: {} }
];
const st = (a) => Object.fromEntries(reqs.map((r, i) => [r.key, a[i]]));
const status = [
  { camper_id: 'k1', family_id: 'f1', first_name: 'Yosef', last_name: 'Levi', grade: '8th', family_name: 'Levi', sessions: ['First Half'], bunks: ['Bunk A'], statuses: st(['received', 'received', 'received', 'missing', 'missing', 'not_needed']), missing: 2 },
  { camper_id: 'k2', family_id: 'f1', first_name: 'Chaim', last_name: 'Levi', grade: '6th', family_name: 'Levi', sessions: ['Second Half'], bunks: [], statuses: st(['received', 'approved', 'rejected', 'approved', 'missing', 'received']), missing: 2 },
  { camper_id: 'k3', family_id: 'f2', first_name: 'Shmuel', last_name: 'Cohen', grade: '7th', family_name: 'Cohen', sessions: ['First Half'], bunks: [], statuses: st(['received', 'approved', 'approved', 'approved', 'approved', 'not_needed']), missing: 0 }
];
const FAKE = {
  session: { access_token: 'x', user: { email: 'dir@example.org' } },
  writes: [],
  rpc: {
    site_info: { admin: true, public_test_camp: false, pending_requests: 1, my_request: null },
    my_access: [{ camp_id: 'c1', camp_name: camp.name, role: 'director' }, { camp_id: 'c1', camp_name: camp.name, role: 'infirmary' }, { camp_id: 'c1', camp_name: camp.name, role: 'counselor', session_id: 's1', bunk_id: 'b1' }],
    form_status: status,
    bunk_list: [{ camper_id: 'k1', first_name: 'Yosef', last_name: 'Levi', grade: '8th', alert: 'Peanut allergy, EpiPen' }],
    sfsp_connection: { sfsp_camp_id: 'abc', sfsp_form_url: 'https://www.wgcamps.com/apply.html', has_secret: true },
    log_file_view: null,
    my_permissions: { director: true, items: {}, roles: [{ role: 'director', label: 'Director', scope: 'camp' }] },
    camper_alerts: [{ camper_id: 'k1', alert: 'Peanut allergy, EpiPen' }]
  },
  tables: {
    camps: [camp], requirements: reqs,
    roles: [{ key: 'director', label: 'Director', scope: 'camp', sort: 1 }, { key: 'office', label: 'Office', scope: 'camp', sort: 2 }, { key: 'infirmary', label: 'Infirmary', scope: 'camp', sort: 4 }, { key: 'counselor', label: 'Counselor', scope: 'bunk', sort: 6 }],
    perm_items: [{ key: 'roster', label: 'Camper list', kind: 'builtin', sort: 1 }, { key: 'health_forms', label: 'Health forms', kind: 'builtin', sort: 4 }, { key: 'f_shirt', label: 'T-shirt size', kind: 'field', sort: 101 }],
    permissions: [{ role_key: 'office', item_key: 'roster', can_see: true, can_change: true }],
    camper_fields: [{ camper_id: 'k1', item_key: 'f_shirt', value: 'Youth L' }],
    sessions: [{ id: 's1', name: 'First Half' }, { id: 's2', name: 'Second Half' }],
    campers: [
      { id: 'k1', family_id: 'f1', external_id: 'campflow:camper:501', first_name: 'Yosef', last_name: 'Levi', grade: '8th', gender: 'Male', date_of_birth: '2013-03-14', active: true, hebrew_name: 'Yosef',
        families: { external_id: 'campflow:10001', last_name: 'Levi', father_first: 'Moshe', mother_first: 'Rivka', father_phone: '(732) 555-0101', mother_phone: '(732) 555-0102', city: 'Lakewood' },
        enrollments: [{ sessions: { name: 'First Half' } }], bunk_assignments: [{ bunks: { name: 'Bunk A' } }], camper_health: { alert: 'Peanut allergy, EpiPen' } },
      { id: 'k2', family_id: 'f1', external_id: 'campflow:camper:502', first_name: 'Chaim', last_name: 'Levi', grade: '6th', gender: 'Male', date_of_birth: '2015-07-02', active: true,
        families: { external_id: 'campflow:10001', last_name: 'Levi', father_first: 'Moshe', mother_first: 'Rivka', father_phone: '(732) 555-0101' },
        enrollments: [{ sessions: { name: 'Second Half' } }], bunk_assignments: [], camper_health: null },
      { id: 'k3', family_id: 'f2', external_id: 'campflow:camper:503', first_name: 'Shmuel', last_name: 'Cohen', grade: '10th', gender: 'Male', date_of_birth: '2010-01-20', active: true,
        families: { external_id: 'campflow:10002', last_name: 'Cohen', father_first: 'Dovid', father_phone: '(845) 555-0201' },
        enrollments: [{ sessions: { name: 'First Half' } }], bunk_assignments: [{ bunks: { name: 'Bunk B' } }], camper_health: [] }],
    families: [{ id: 'f1', external_id: 'campflow:10001', last_name: 'Levi', father_title: 'Rabbi', father_first: 'Moshe', father_phone: '(732) 555-0101', father_email: 'moshe@example.org', mother_first: 'Rivka', address: '12 Oak St', city: 'Lakewood', state: 'NJ', zip: '08701', emergency_contacts: ['Sara Katz (Aunt) — (732) 555-0199'], disclosures: { 'Medical Authorization': 'Yes' }, active: true }],
    submissions: [{ id: 'x1', requirement_id: 'r3', family_id: 'f1', camper_id: 'k1', status: 'received', files: [{ path: 'c1/f1/b/0-physical.jpg', name: 'physical.jpg' }], answers: {}, submitted_by: 'family', created_at: '2026-11-20T15:00:00Z' },
      { id: 'x2', requirement_id: 'r2', family_id: 'f1', camper_id: 'k1', status: 'received', files: [{ path: 'c1/f1/b/0-card.jpg', name: 'card.jpg' }], answers: { carrier: 'Aetna', member_id: 'W123' }, submitted_by: 'family', created_at: '2026-11-20T15:00:00Z' }],
    camper_health: [{ camper_id: 'k1', alert: 'Peanut allergy, EpiPen', updated_by: 'nurse@example.org', updated_at: '2026-11-21T10:00:00Z' }],
    reminder_log: [{ sent_at: '2026-11-15T14:05:00Z', kind: 'welcome', error: null }],
    bunks: [{ id: 'b1', name: 'Bunk A', session_id: 's1' }, { id: 'b2', name: 'Bunk B', session_id: 's1' }],
    enrollments: [{ camper_id: 'k1', campers: { id: 'k1', first_name: 'Yosef', last_name: 'Levi', grade: '8th', active: true } }, { camper_id: 'k3', campers: { id: 'k3', first_name: 'Shmuel', last_name: 'Cohen', grade: '7th', active: true } }],
    bunk_assignments: [{ bunk_id: 'b1', camper_id: 'k1' }],
    finance_accounts: [{ family_id: 'f1', total_charges_cents: 320000, total_payments_cents: 100000, balance_cents: 220000, as_of: '2026-11-10T13:05:00Z', families: { id: 'f1', last_name: 'Levi', father_first: 'Moshe', mother_first: 'Rivka', active: true } }],
    finance_entries: [{ family_id: 'f1', occurred_on: '2026-10-01', kind: 'charge', description: 'Tuition', amount_cents: 160000 }],
    import_runs: [{ created_at: '2026-11-10T13:06:00Z', report: 'families', via: 'email', counts: { families: 31, added: 31, updated: 0, flagged: 0 }, problems: [] }],
    staff: [{ id: 'm1', email: 'dir@example.org', role: 'director' }, { id: 'm2', email: 'nurse@example.org', role: 'infirmary' }, { id: 'm3', email: 'coun@example.org', role: 'counselor', session_id: 's1', bunk_id: 'b1' }],
    audit_log: [{ at: '2026-11-21T10:00:00Z', actor: 'nurse@example.org', action: 'update', entity: 'submissions', detail: { status: 'approved' } }]
  }
};
const portalView = {
  family: { id: 'f1', last_name: 'Levi', father: 'Moshe', mother: 'Rivka' },
  camp: { name: camp.name, deadline: '2027-06-04', phone: '(732) 555-0000', email: 'office@example.org' },
  sfsp_link: 'https://www.wgcamps.com/apply.html?c=abc&r=x.y',
  family_requirements: [{ ...reqs[0], status: 'missing' }, { ...reqs[4], status: 'missing' }],
  campers: [{ id: 'k1', first_name: 'Yosef', last_name: 'Levi', requirements: [reqs[1], reqs[2], reqs[3], reqs[5]].map((r, i) => ({ ...r, status: ['received', 'rejected', 'missing', 'missing'][i], reason: i === 1 ? 'The doctor\'s signature is missing.' : null })) },
    { id: 'k2', first_name: 'Chaim', last_name: 'Levi', requirements: [reqs[1], reqs[2], reqs[3], reqs[5]].map(r => ({ ...r, status: 'approved' })) }]
};

const browser = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
async function newPage(width, fake = FAKE) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${page.url()}: console: ${m.text()}`); });
  page.on('dialog', d => d.accept('Please send a clearer photo.'));
  await ctx.addInitScript(f => { window.FAKE = f; }, fake);
  await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(here, 'fake-supabase.js'), 'utf8') });
    if (u.hostname === 'fake.supabase.co' && u.pathname.endsWith('/portal')) {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'upload-urls') return route.fulfill({ json: { uploads: body.files.map((f, i) => ({ path: `c1/f1/z/${i}-${f.name}`, token: 't', ...f })) } });
      return route.fulfill({ json: portalView });
    }
    if (u.hostname === 'fake.supabase.co') return route.fulfill({ json: { sent: 1, skipped: 0, failed: 0, link: 'https://x/portal.html?t=abc' } });
    if (u.hostname === 'app.test') {
      if (u.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: "window.ROSTER_CONFIG={supabaseUrl:'https://fake.supabase.co',supabaseAnonKey:'anon',campSlug:'teumim'};" });
      const file = path.join(web, u.pathname === '/' ? 'index.html' : u.pathname);
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.pdf') ? 'application/pdf' : 'text/html';
      try { return route.fulfill({ contentType: type, body: await readFile(file) }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  return page;
}

const page = await newPage(1360);
for (const h of ['roster', 'forms', 'camper/k1', 'settings/access', 'bunks', 'mybunk', 'money', 'imports', 'settings', 'activity']) {
  await page.goto(`http://app.test/#${h}`);
  await page.waitForTimeout(350);
  const text = await page.locator('main').innerText();
  if (/Loading…/.test(text) && text.length < 20) errors.push(`#${h} never finished loading`);
  await page.screenshot({ path: path.join(out, `staff-${h.replace('/', '-')}.png`), fullPage: true });
}
// Roster: grade filter, sort by grade (6th before 10th), export.
await page.goto('http://app.test/#roster'); await page.waitForTimeout(300);
await page.locator('summary', { hasText: 'Grade' }).click();
await page.locator('[data-f="grade"][value="8th"]').check(); await page.waitForTimeout(100);
let names = await page.locator('table.grid tbody td:nth-child(2)').allInnerTexts();
if (names.join() !== 'Yosef') errors.push(`grade filter shows ${names.join()}`);
await page.locator('[data-f="grade"][value="10th"]').check(); await page.waitForTimeout(100);
await page.locator('[data-sort="grade"]').click(); await page.waitForTimeout(100);
names = await page.locator('table.grid tbody td:nth-child(2)').allInnerTexts();
if (names.join() !== 'Yosef,Shmuel') errors.push(`grade sort shows ${names.join()}`);
await page.locator('[data-sort="grade"]').click(); await page.waitForTimeout(100);
names = await page.locator('table.grid tbody td:nth-child(2)').allInnerTexts();
if (names.join() !== 'Shmuel,Yosef') errors.push(`grade sort descending shows ${names.join()}`);
await page.screenshot({ path: path.join(out, 'staff-roster-filtered.png'), fullPage: true });
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#rcsv').click()]);
const csv = await readFile(await dl.path(), 'utf8');
if (!/^\ufeffLast name,First name,Grade/.test(csv) || csv.trim().split('\n').length !== 3) errors.push('roster export wrong: ' + csv.slice(0, 120));

// Interactions: filter to missing physicals, approve a form, reject one.
await page.evaluate(() => { window.FAKE.tables.camp_requests = [{ id: '00000000-0000-0000-0000-00000000aa01', email: 'sam@example.com', name: 'Sam Stranger', camp_name: 'Camp Sunshine', location: 'Monsey, NY', campers: '120', status: 'pending', created_at: '2026-11-16T15:00:00Z' }]; window.FAKE.tables.site_settings = [{ id: true, public_test_camp: false }]; });
await page.goto('http://app.test/#requests'); await page.waitForTimeout(400);
if (!/Camp Sunshine/.test(await page.locator('main').innerText())) errors.push('owner does not see camp requests');
await page.screenshot({ path: path.join(out, 'owner-requests.png'), fullPage: true });
await page.goto('http://app.test/#forms'); await page.waitForTimeout(300);
await page.selectOption('#fm', 'physical'); await page.waitForTimeout(100);
const shown = await page.locator('#count').innerText();
if (!/1 camper/.test(shown)) errors.push(`missing-physical filter shows "${shown}"`);
await page.goto('http://app.test/#camper/k1'); await page.waitForTimeout(300);
await page.locator('[data-approve]').first().click(); await page.waitForTimeout(200);
const approved = await page.evaluate(() => window.FAKE.writes.find(w => w.table === 'submissions' && w.op === 'update' && w.value.status === 'approved'));
if (!approved) errors.push('approve did not write');

// Family portal on a phone-sized screen.
const phone = await newPage(390);
await phone.goto('http://app.test/portal.html?t=abcdefghijklmnopqrstuvwxyz0123456789ABCD');
await phone.waitForTimeout(400);
await phone.screenshot({ path: path.join(out, 'portal.png'), fullPage: true });
await phone.getByRole('button', { name: /Physical exam/ }).first().click();
await phone.waitForTimeout(100);
await phone.screenshot({ path: path.join(out, 'portal-open.png'), fullPage: false });
const greeting = await phone.locator('h1').first().innerText();
if (greeting !== 'Parents of Yosef and Chaim Levi') errors.push(`portal greeting is "${greeting}"`);
const reason = await phone.locator('.reason').innerText().catch(() => '');
if (!/signature is missing/.test(reason)) errors.push('rejection reason not shown to family');
await phone.getByRole('button', { name: /Medical history/ }).first().click();
await phone.getByText('Yes', { exact: true }).first().click();
await phone.waitForTimeout(100);
if (!(await phone.locator('textarea[data-field="allergies"]').count())) errors.push('medical history details did not appear after "Yes"');
await phone.screenshot({ path: path.join(out, 'portal-medical.png'), fullPage: false });

// Menu: sidebar on desktop shrinks to icons; on phones it slides in and there's a bottom bar.
await page.goto('http://app.test/#forms'); await page.waitForTimeout(300);
if (await page.locator('#drawer nav a[aria-current="page"]').innerText() !== 'Forms') errors.push('menu does not mark the current page');
if (!(await page.locator('header.top .logo').isVisible())) errors.push('logo missing from the top bar');
await page.locator('#menuBtn').click(); await page.waitForTimeout(250);
if (!(await page.evaluate(() => document.body.classList.contains('mini')))) errors.push('menu button did not shrink the sidebar');
await page.screenshot({ path: path.join(out, 'staff-menu-mini.png') });
await page.locator('#menuBtn').click(); await page.waitForTimeout(250);
const small = await newPage(390);
await small.goto('http://app.test/#roster'); await small.waitForTimeout(400);
if (await small.locator('#drawer').evaluate(d => d.getBoundingClientRect().right > 0)) errors.push('phone menu is showing before it is opened');
if (!(await small.locator('#botbar a').count())) errors.push('phone bottom bar missing');
if (await small.locator('header.top .logo').isVisible()) errors.push('logo should not show in the phone top bar');
await small.screenshot({ path: path.join(out, 'phone-roster.png') });
await small.locator('#menuBtn').click(); await small.waitForTimeout(350);
await small.screenshot({ path: path.join(out, 'phone-menu-open.png') });
if (!(await small.locator('.foot-brand .logo').isVisible())) errors.push('logo missing at the bottom of the phone menu');
await small.locator('#drawer nav a', { hasText: 'Bunks' }).click(); await small.waitForTimeout(400);
if (!/#bunks$/.test(small.url()) || await small.locator('#drawer').evaluate(d => d.classList.contains('open'))) errors.push('phone menu link did not go to Bunks and close');

// Signed out: Google pop-up, or email and password on the page (works inside a home-screen app).
const OUT = JSON.parse(JSON.stringify(FAKE)); OUT.session = null;
const so = await newPage(390, OUT);
await so.goto('http://app.test/'); await so.waitForTimeout(400);
await so.screenshot({ path: path.join(out, 'signin-phone.png'), fullPage: true });
await so.locator('#em').fill('me@example.com'); await so.locator('#pwd').fill('wrongpassword'); await so.locator('#pw button').click(); await so.waitForTimeout(300);
if (!(await so.evaluate(() => (window.FAKE.signIns || []).includes('me@example.com')))) errors.push('password sign-in not tried');
if (!/don't match/.test(await so.locator('.toast').last().innerText().catch(() => ''))) errors.push('wrong password message missing');
await so.getByRole('link', { name: 'Create an account' }).click(); await so.waitForTimeout(200);
await so.locator('#em').fill('me@example.com'); await so.locator('#pwd').fill('longenough1'); await so.locator('#pw button').click(); await so.waitForTimeout(300);
if (!/confirm the address/.test(await so.locator('main').innerText())) errors.push('sign-up confirm message missing');
await so.getByRole('link', { name: 'Forgot password?' }).click(); await so.waitForTimeout(200);
if (await so.locator('#pwd').count()) errors.push('forgot form asks for a password');
await so.context().close();

// Online registration, as a parent on a phone: closed, then open; required fields; saving and sending.
{
  const PARENT = JSON.parse(JSON.stringify(FAKE)); PARENT.session.user = { id: 'u-parent', email: 'parent@example.com' };
  PARENT.rpc.registration_info = { camp_id: 'c1', name: 'Camp Teumim', kind: 'camper', open: false, enabled: false, sessions: [], contact: 'office@example.com' };
  PARENT.tables.applications = [];
  let reg = await newPage(390, PARENT);
  await reg.goto('http://app.test/register.html?camp=teumim'); await reg.waitForTimeout(400);
  if (!/isn't open yet/.test(await reg.locator('main').innerText())) errors.push('closed registration not explained');
  await reg.context().close();
  PARENT.rpc.registration_info = { ...PARENT.rpc.registration_info, open: true, enabled: true, intro: 'Welcome to camp!', agreement: 'Camp rules: be kind.',
    sessions: [{ id: 's1', name: 'First Half', starts_on: '2027-07-01', ends_on: '2027-07-21' }, { id: 's2', name: 'Second Half', starts_on: '2027-07-22', ends_on: '2027-08-12' }],
    form: { builtin: { 'camper.hebrew_name': { mode: 'hidden' }, 'zip': { mode: 'optional' }, 'camper.dob': { label: 'Birthday' } },
      custom: [{ id: 'shirt1', section: 'camper', label: 'T-shirt size', type: 'choice', options: ['S', 'M', 'L'], required: true },
               { id: 'shul01', section: 'family', label: 'Which shul?', type: 'text' },
               { id: 'swim01', section: 'camper', label: 'Activities', type: 'multi', options: ['Swim', 'Art'], required: false }] },
    payment: { plans: [{ id: 'full01', name: 'Pay in full', description: 'One payment by June 1', link: 'https://pay.example.com/full' }, { id: 'three1', name: 'Three payments' }], show: 'after_send' } };
  reg = await newPage(390, PARENT);
  await reg.goto('http://app.test/register.html?camp=teumim'); await reg.waitForTimeout(400);
  if ((await reg.locator('[data-k="father.email"]').inputValue()) !== 'parent@example.com') errors.push('parent email not filled in');
  if (await reg.locator('[data-k="campers.0.hebrew_name"]').count()) errors.push('hidden question still asked');
  if (!/Birthday/.test(await reg.locator('main').innerText())) errors.push('renamed question not shown');
  await reg.locator('#sendapp').click(); await reg.waitForTimeout(200);
  if (!/Please fill in family last name/.test(await reg.locator('.formerr').innerText().catch(() => ''))) errors.push('missing fields not listed: ' + await reg.locator('.formerr').innerText().catch(e => 'none ' + e.message.slice(0,80)));
  const fill = async (k, v) => reg.locator(`[data-k="${k}"]`).fill(v);
  await fill('last_name', 'Goldberg'); await fill('address', '14 Ocean Pkwy'); await fill('city', 'Brooklyn'); await fill('state', 'NY'); await fill('zip', '11218');
  await fill('father.first', 'Yaakov'); await fill('father.phone', '718-555-0140');
  await fill('emergency.0.name', 'Miriam Stern'); await fill('emergency.0.phone', '718-555-0199');
  await fill('campers.0.first', 'Shimon'); await fill('campers.0.dob', '2015-05-12');
  await reg.locator('[data-k="campers.0.grade"]').selectOption('5th'); await reg.locator('[data-k="campers.0.gender"]').selectOption('Male');
  await reg.locator('[data-sessions="0"] input[value="s1"]').check();
  await reg.locator('#agree').check(); await reg.locator('#sig').fill('Yaakov Goldberg');
  await reg.locator('#sendapp').click(); await reg.waitForTimeout(200);
  const still = await reg.locator('.formerr').innerText().catch(() => '');
  if (!/t-shirt size/.test(still) || !/payment plan/.test(still) || /zip/i.test(still)) errors.push('custom required question / plan not checked: ' + still);
  await reg.locator('[data-k="campers.0.custom.shirt1"]').selectOption('M');
  await reg.locator('[data-multi="campers.0.custom.swim01"] input[value="Swim"]').check();
  await fill('custom.shul01', 'Agudah');
  await reg.locator('[data-plan] input[value="full01"]').check();
  await reg.locator('#addkid').click(); await reg.waitForTimeout(100);
  await fill('campers.1.first', 'Tzvi'); await fill('campers.1.dob', '2017-09-02');
  await reg.locator('[data-k="campers.1.grade"]').selectOption('3rd'); await reg.locator('[data-k="campers.1.gender"]').selectOption('Male');
  await reg.locator('[data-sessions="1"] input[value="s2"]').check();
  await reg.locator('[data-k="campers.1.custom.shirt1"]').selectOption('S');
  await reg.locator('#agree').check(); await reg.locator('#sig').fill('Yaakov Goldberg');
  await reg.screenshot({ path: path.join(out, 'register-form.png'), fullPage: true });
  await reg.locator('#sendapp').click(); await reg.waitForTimeout(600);
  const w = await reg.evaluate(() => window.FAKE.writes.filter(x => x.table === 'applications'));
  const last = w.filter(x => x.value && x.value.data).pop();
  if (!last || last.value.data.campers[0].custom.shirt1 !== 'M' || last.value.data.campers[0].custom.swim01[0] !== 'Swim' || last.value.data.custom.shul01 !== 'Agudah' || last.value.data.payment_plan_name !== 'Pay in full') errors.push('answers not saved: ' + JSON.stringify(last && last.value.data));
  if (!last || last.value.data.campers.length !== 2 || last.value.data.campers[1].sessions[0] !== 's2' || last.value.data.father.first !== 'Yaakov' || last.value.signature !== 'Yaakov Goldberg') errors.push('application not saved right: ' + JSON.stringify(last && last.value));
  if (!w.some(x => x.op === 'update' && x.value.status === 'submitted')) errors.push('application not sent');
  if (!/We received your application/.test(await reg.locator('main').innerText())) errors.push('no confirmation after sending');
  if (!(await reg.getByRole('link', { name: 'Pay now' }).count())) errors.push('no Pay now link after sending');
  await reg.screenshot({ path: path.join(out, 'register-sent.png'), fullPage: true });
  await reg.context().close();
}

// A session's own link: only that session; a link to a session not offered online is closed.
{
  const P2 = JSON.parse(JSON.stringify(FAKE)); P2.session.user = { id: 'u-p2', email: 'p2@example.com' }; P2.tables.applications = [];
  P2.rpc.registration_info = { camp_id: 'c1', name: 'Camp Teumim', kind: 'camper', open: true, enabled: true, form: {}, payment: {},
    sessions: [{ id: 's1', name: 'Teumim Tammuz', starts_on: '2027-07-11' }, { id: 's2', name: 'Teumim Mesivta', starts_on: '2027-08-08' }] };
  let r = await newPage(390, P2);
  await r.goto('http://app.test/register.html?camp=teumim&session=teumim-tammuz'); await r.waitForTimeout(400);
  if (!/Teumim Tammuz/.test(await r.locator('h1').innerText())) errors.push('session link heading');
  const boxes = await r.locator('[data-sessions="0"] input').evaluateAll(x => x.map(i => i.value + ':' + i.checked));
  if (boxes.join() !== 's1:true') errors.push('session link should offer only its session, ticked: ' + boxes.join());
  await r.goto('http://app.test/register.html?camp=teumim&session=nope'); await r.waitForTimeout(400);
  if (!/isn't open/.test(await r.locator('main').innerText())) errors.push('unknown session link not closed');
  await r.context().close();
}

// A staff application on a phone.
{
  const TEEN = JSON.parse(JSON.stringify(FAKE)); TEEN.session.user = { id: 'u-teen', email: 'teen@example.com' }; TEEN.tables.applications = [];
  TEEN.rpc.registration_info = { camp_id: 'c1', name: 'Camp Teumim', kind: 'staff', open: true, enabled: true, approval: true, positions: ['Lifeguard', 'Waiter', 'Counselor'], tax_form: 'choice', tax_when: 'apply',
    sessions: [{ id: 's1', name: 'First Half', starts_on: '2027-07-01', ends_on: '2027-07-21' }], form: {}, payment: {} };
  const t = await newPage(390, TEEN);
  await t.goto('http://app.test/register.html?camp=teumim&kind=staff'); await t.waitForTimeout(400);
  if (!/Apply to work at Camp Teumim/.test(await t.locator('h1').innerText())) errors.push('staff page heading');
  const f = async (k, v) => t.locator(`[data-k="${k}"]`).fill(v);
  await f('first', 'Avi'); await f('last', 'Stein'); await f('dob', '2009-04-01'); await t.locator('[data-k="gender"]').selectOption('Male');
  await f('phone', '732-555-0300'); await f('address', '1 Main St'); await f('city', 'Lakewood'); await f('state', 'NJ'); await f('zip', '08701');
  await f('school', 'Yeshiva'); await t.locator('[data-k="grade"]').selectOption('11th');
  await t.locator('[data-positions] input[value="Lifeguard"]').check(); await t.locator('[data-staffsessions] input[value="s1"]').check();
  await f('father.first', 'Shmuel'); await f('father.phone', '732-555-0301');
  await f('emergency.0.name', 'Dina Stein'); await f('emergency.0.phone', '732-555-0302');
  await f('camper_experience.0.camp', 'Camp A'); await f('camper_experience.0.years', '2018-2022');
  await t.locator('#agree').check(); await t.locator('#sig').fill('Avi Stein');
  await t.locator('#sendapp').click(); await t.waitForTimeout(300);
  if (!/camps you worked at/.test(await t.locator('.formerr').innerText().catch(() => ''))) errors.push('staff experience not required');
  if (!/your tax form \(W-4 or W-9\)/.test(await t.locator('.formerr').innerText().catch(() => ''))) errors.push('tax form not required');
  await t.locator('[data-none="no_staff_experience"]').check();
  // The W-9 questionnaire: checks, then fills in and signs the IRS form here; the SSN must not be saved anywhere but the PDF.
  await t.locator('[name="taxtype"][value="W-9"]').check(); await t.waitForTimeout(100);
  if ((await t.locator('#tx_name').inputValue()) !== 'Avi Stein' || (await t.locator('#tx_addr').inputValue()) !== '1 Main St') errors.push('W-9 questions not filled from the application');
  await t.locator('#tx_ssn').fill('123-45-6789'); await t.locator('#tx_ssn2').fill('123-45-6780');
  await t.locator('#taxsign').click(); await t.waitForTimeout(200);
  if (!/don't match/.test(await t.locator('#taxmsg').innerText().catch(() => ''))) errors.push('mismatched SSN not caught');
  await t.locator('#tx_ssn2').fill('123456789'); await t.locator('#tx_perjury').check(); await t.locator('#tx_sig').fill('Avi Stein');
  await t.screenshot({ path: path.join(out, 'staff-w9-questions.png'), fullPage: true });
  await t.locator('#taxsign').click(); await t.waitForTimeout(3000);
  const up = await t.evaluate(() => window.FAKE.uploads || []);
  if (!up.length || up[0].bucket !== 'tax-forms' || !/^c1\/[^/]+\/\d+-Form_W-9_Avi_Stein\.pdf$/.test(up[0].path)) errors.push('W-9 not saved right: ' + JSON.stringify(up) + ' ' + (await t.locator('#taxmsg').innerText().catch(() => '')));
  if (!/W-9 filled in and signed/.test(await t.locator('#taxsec').innerText())) errors.push('W-9 not shown as signed');
  if (JSON.stringify(await t.evaluate(() => window.FAKE.writes)).replace(/\D/g, '').includes('123456789')) errors.push('SSN was saved in the application data');
  await t.screenshot({ path: path.join(out, 'staff-apply.png'), fullPage: true });
  await t.locator('#sendapp').click(); await t.waitForTimeout(600);
  const sw = await t.evaluate(() => window.FAKE.writes.filter(x => x.table === 'applications'));
  const sl = sw.filter(x => x.value && x.value.data).pop();
  if (!sl || sl.value.data.positions[0] !== 'Lifeguard' || sl.value.data.camper_experience[0].camp !== 'Camp A' || !sl.value.data.no_staff_experience || sl.value.data.sessions[0] !== 's1' || sl.value.kind !== undefined && sl.value.kind !== 'staff') errors.push('staff application not saved right: ' + JSON.stringify(sl && sl.value));
  if (!sw.some(x => x.op === 'insert' && x.value.kind === 'staff')) errors.push('not saved as a staff application');
  if (!sl || !sl.value.data.tax_form || sl.value.data.tax_form.type !== 'W-9') errors.push('tax form not recorded on the application');
  if (!/We received your application/.test(await t.locator('main').innerText())) errors.push('no staff confirmation');
  await t.context().close();
}

// The public: signed in but on no camp. Until the owner opens Camp Test Site to everyone, they can only ask to open a camp.
const STRANGER = JSON.parse(JSON.stringify(FAKE)); STRANGER.rpc.my_access = []; STRANGER.session.user.email = 'stranger@example.com';
STRANGER.rpc.site_info = { admin: false, public_test_camp: false, my_request: null };
const pub = await newPage(1360, STRANGER);
await pub.goto('http://app.test/'); await pub.waitForTimeout(400);
if (await pub.getByRole('button', { name: /Explore Camp Test Site/ }).count()) errors.push('the public can open the test camp before it is opened to them');
if (await pub.locator('#drawer nav a').count() && await pub.locator('#drawer').isVisible()) errors.push('the public sees the menu');
await pub.locator('#rq_name').fill('Sam Stranger'); await pub.locator('#rq_camp').fill('Camp Sunshine'); await pub.locator('#rq_loc').fill('Monsey, NY');
await pub.screenshot({ path: path.join(out, 'public-request.png'), fullPage: true });
await pub.locator('#reqf button.primary').click(); await pub.waitForTimeout(400);
const sentReq = await pub.evaluate(() => window.FAKE.writes.find(w => w.table === 'camp_requests'));
if (!sentReq || sentReq.value.camp_name !== 'Camp Sunshine' || sentReq.value.email) errors.push('camp request not sent right: ' + JSON.stringify(sentReq));
if (!/waiting for approval/.test(await pub.locator('main').innerText())) errors.push('no waiting message after the request');
await pub.screenshot({ path: path.join(out, 'public-waiting.png'), fullPage: true });
await pub.context().close();

// Camp Test Site, as a new user with no camp yet (opened to the public): explore, roster of 500, family page practice, nothing sent anywhere.
const NEW = JSON.parse(JSON.stringify(FAKE)); NEW.rpc.my_access = []; NEW.session.user.email = 'new@example.com';
NEW.rpc.site_info = { admin: false, public_test_camp: true, my_request: null };
const demo = await newPage(1360, NEW);
const serverCalls = [];
demo.on('request', r => { const u = r.url(); if (u.includes('fake.supabase.co')) serverCalls.push(u); });
await demo.goto('http://app.test/'); await demo.waitForTimeout(300);
await demo.screenshot({ path: path.join(out, 'no-access.png') });
if (!(await demo.locator('.signin .logo').count())) errors.push('logo missing on the welcome card');
await demo.getByRole('button', { name: /Explore Camp Test Site/ }).click(); await demo.waitForTimeout(500);
const banner = await demo.locator('#demobar').innerText();
if (!/practice camp/.test(banner) || !/Start over/.test(banner)) errors.push('test camp banner missing');
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(800);
const count = await demo.locator('main p.small').first().innerText();
if (!/500 of 500 campers/.test(count)) errors.push(`test camp roster shows "${count}"`);
await demo.screenshot({ path: path.join(out, 'demo-roster.png') });
await demo.goto('http://app.test/#forms'); await demo.waitForTimeout(800);
await demo.screenshot({ path: path.join(out, 'demo-forms.png') });
await demo.locator('tr.click').first().click(); await demo.waitForTimeout(500);
await demo.screenshot({ path: path.join(out, 'demo-camper.png'), fullPage: true });
await demo.locator('#sendnow').click(); await demo.waitForTimeout(200);
const toastText = await demo.locator('.toast').last().innerText().catch(() => '');
if (!/aren.t sent/.test(toastText)) errors.push(`reminder in test camp: "${toastText}"`);
const [popup] = await Promise.all([demo.waitForEvent('popup'), demo.locator('#copylink').click()]);
popup.on('pageerror', e => errors.push(`practice family page: ${e.message}`));
await popup.waitForTimeout(600);
const ptext = await popup.locator('main').innerText();
if (!/Practice family page/.test(ptext) || !/Parents of/.test(ptext)) errors.push('practice family page did not open: ' + ptext.slice(0, 100));
const sfspHref = await popup.locator('a.btn.primary').first().getAttribute('href').catch(() => null);
await popup.screenshot({ path: path.join(out, 'demo-portal.png'), fullPage: true });
const consent = popup.getByRole('button', { name: /Consent to treat/ });
if (await consent.count()) {
  await consent.click();
  await popup.locator('input[data-agree]').check();
  await popup.locator('input[data-field="signed_name"]').fill('Practice Parent');
  await popup.getByRole('button', { name: 'Send' }).click(); await popup.waitForTimeout(400);
  await demo.waitForTimeout(400);
  const t2 = await demo.locator('.toast').last().innerText().catch(() => '');
  if (!/practice form came in/.test(t2)) errors.push('staff tab did not get the practice form: ' + t2);
}
await popup.getByRole('button', { name: /SFSP meal form/ }).click().catch(() => {});
const sfspLink = await popup.locator('a', { hasText: 'Fill in the SFSP form' }).getAttribute('href').catch(() => null);
if (sfspLink && sfspLink !== 'https://wgcamps.com/apply.html?demo=1') errors.push('SFSP button in the test camp goes to ' + sfspLink);
// Start over wipes changes; going to the sign-out clears too.
await demo.goto('http://app.test/#settings'); await demo.waitForTimeout(400);
if (await demo.locator('#se').isVisible() || !(await demo.locator('.foldhead').count())) errors.push('settings cards should start closed');
await demo.screenshot({ path: path.join(out, 'demo-settings-closed.png'), fullPage: true });
{ const closed = demo.locator('.foldhead[aria-expanded=\"false\"]'); for (let n = await closed.count(); n > 0; n--) await closed.first().click(); }
await demo.locator('#se').fill('trial@example.com'); await demo.locator('#addstaff button.primary').click(); await demo.waitForTimeout(200);
let staffText = await demo.locator('main').innerText();
if (!/trial@example.com/.test(staffText)) errors.push('test camp: adding staff did not show');
await demo.locator('#demoreset').click(); await demo.waitForTimeout(500);
await demo.goto('http://app.test/#settings'); await demo.waitForTimeout(400);
{ const closed = demo.locator('.foldhead[aria-expanded=\"false\"]'); for (let n = await closed.count(); n > 0; n--) await closed.first().click(); }
staffText = await demo.locator('main').innerText();
if (/trial@example.com/.test(staffText)) errors.push('Start over did not wipe changes');
// "Viewing as" each role.
const nav = async () => (await demo.locator('#drawer nav a').evaluateAll(as => as.map(a => a.querySelector('span').firstChild.textContent.trim()))).join(',');
const viewAs = async k => { await demo.selectOption('#demorole', k); await demo.waitForTimeout(700); };
await viewAs('counselor@bunk-boys-1');
if (await nav() !== 'Roster,My bunk') errors.push('counselor nav: ' + await nav());
if (!/Bunk 1/.test(await demo.locator('main').innerText())) errors.push('counselor does not see Bunk 1');
await demo.screenshot({ path: path.join(out, 'demo-as-counselor.png') });
await viewAs('head_counselor@sess-boys');
if (await nav() !== 'Roster,Bunks') errors.push('head counselor nav: ' + await nav());
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(800);
const hc = await demo.locator('main p.small').first().innerText();
if (!/250 of 250/.test(hc)) errors.push('head counselor roster: ' + hc);
if (/Father phone/i.test(await demo.locator('table.grid thead').innerText())) errors.push('head counselor sees parent phones');
await demo.screenshot({ path: path.join(out, 'demo-as-head.png') });
await viewAs('finance');
if (!/Money/.test(await nav()) || /Forms/.test(await nav())) errors.push('finance nav: ' + await nav());
await viewAs('office');
await demo.goto('http://app.test/#forms'); await demo.waitForTimeout(800);
await demo.locator('tr.click').first().click(); await demo.waitForTimeout(500);
if (await demo.locator('[data-approve]').count()) errors.push('office sees Approve buttons');
await viewAs('infirmary');
if (/Settings|Money/.test(await nav())) errors.push('infirmary nav: ' + await nav());
await viewAs('director');
if (await nav() !== 'Roster,Forms,Bunks,Staff roster,Money,Imports,Applications,Reports,Settings,Activity') errors.push('director nav: ' + await nav());

// Who can see what (test camp): add a Kitchen role that sees names and alerts, then view as Kitchen.
await demo.goto('http://app.test/#settings/access'); await demo.waitForTimeout(600);
await demo.screenshot({ path: path.join(out, 'demo-access.png'), fullPage: true });
await demo.locator('#rname').fill('Kitchen'); await demo.locator('#addrole button').click(); await demo.waitForTimeout(500);
await demo.locator('input[data-p="see"][data-r="kitchen"][data-i="roster"]').check(); await demo.waitForTimeout(200);
await demo.locator('input[data-p="see"][data-r="kitchen"][data-i="alerts"]').check(); await demo.waitForTimeout(200);
await demo.locator('#iname').fill('Swim level'); await demo.locator('#additem button').click(); await demo.waitForTimeout(500);
await demo.locator('input[data-p="change"][data-r="office"][data-i="f_swim_level"]').check(); await demo.waitForTimeout(200);
if (!(await demo.locator('input[data-p="see"][data-r="office"][data-i="f_swim_level"]').isChecked())) errors.push('Change did not tick See');
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(600);
await viewAs('kitchen');
if (await nav() !== 'Roster') errors.push('kitchen nav: ' + await nav());
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(800);
const kh = await demo.locator('table.grid thead').innerText();
if (!/Alert/i.test(kh) || /Father/i.test(kh)) errors.push('kitchen roster columns: ' + kh.replace(/\s+/g, ' '));
await demo.screenshot({ path: path.join(out, 'demo-as-kitchen.png') });
await viewAs('office');
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(600);
await demo.locator('tr.click').first().click(); await demo.waitForTimeout(600);
if (!(await demo.locator('[data-cf="f_swim_level"]').count())) errors.push('office cannot edit the new detail');
await demo.locator('[data-cf="f_swim_level"]').fill('Level 3'); await demo.locator('#savecf').click(); await demo.waitForTimeout(300);
await viewAs('director');

// Daily registration report: the director picks columns in Settings; the Reports tab and past reports use them.
await demo.goto('http://app.test/#reports'); await demo.waitForTimeout(600);
const rep = await demo.locator('main').innerText();
if (!/Past reports/.test(rep) || !/So far for the next report/.test(rep)) errors.push('reports page: ' + rep.slice(0, 200));
await demo.goto('http://app.test/#settings'); await demo.waitForTimeout(500);
{ const closed = demo.locator('.foldhead[aria-expanded=\"false\"]'); for (let n = await closed.count(); n > 0; n--) await closed.first().click(); }
await demo.locator('[data-col="parents"]').uncheck(); await demo.locator('[data-col="phone"]').check();
await demo.locator('[data-col="missing"]').check(); await demo.locator('[data-col="balance"]').check(); await demo.locator('[data-col="mother"]').check();
// Drag Phone up to the top of the list by its dots (the page scrolls while dragging near the top edge).
{
  const grip = demo.locator('#repcols li', { has: demo.locator('[data-col="phone"]') }).locator('.grip');
  await grip.scrollIntoViewIfNeeded();
  const g = await grip.boundingBox();
  await demo.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await demo.mouse.down();
  for (let i = 1; i <= 10; i++) { await demo.mouse.move(g.x + g.width / 2, g.y + (20 - g.y) * i / 10); await demo.waitForTimeout(30); }
  for (let i = 0; i < 80 && (await demo.locator('#repcols li').first().boundingBox()).y < 120; i++) { await demo.mouse.move(g.x + g.width / 2, 20 + (i % 2)); await demo.waitForTimeout(40); }
  const first = await demo.locator('#repcols li').first().boundingBox();
  await demo.mouse.move(g.x + g.width / 2, 300); await demo.waitForTimeout(50);   // out of the scrolling edge
  const first2 = await demo.locator('#repcols li').first().boundingBox();
  await demo.mouse.move(g.x + g.width / 2, first2.y + 5); await demo.waitForTimeout(50);
  await demo.mouse.up();
  const top = await demo.locator('#repcols li').first().locator('[data-col]').getAttribute('data-col');
if (top !== 'phone') errors.push('dragging did not move Phone to the top: ' + top);
}
await demo.locator('#repto').fill('office@example.com, not an address');
await demo.locator('#repf button.primary').click(); await demo.waitForTimeout(200);
if (!/Check this address/.test(await demo.locator('.toast').last().innerText().catch(() => ''))) errors.push('bad report address accepted');
await demo.locator('#repto').fill('office@example.com'); await demo.locator('#repf button.primary').click(); await demo.waitForTimeout(500);
await demo.locator('#reportcard').screenshot({ path: path.join(out, 'demo-report-settings.png') });
await demo.goto('http://app.test/#reports'); await demo.waitForTimeout(600);
await demo.locator('main table.grid a[href^="#reports/"]').first().click(); await demo.waitForTimeout(500);
const rh = (await demo.locator('main table.grid thead').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
if (!/^PHONE CAMPER/i.test(rh.trim()) || /Parents/i.test(rh) || !/Forms missing/i.test(rh) || !/Balance/i.test(rh) || !/Mother/i.test(rh)) errors.push('report columns not applied: ' + rh);
await demo.screenshot({ path: path.join(out, 'demo-report.png'), fullPage: true });
await demo.goto('http://app.test/#reports'); await demo.waitForTimeout(500);
const beforeRuns = await demo.locator('main table.grid a[href^="#reports/"]').count();
await demo.locator('#runnow').click(); await demo.waitForTimeout(600);
if (!/#reports\/dr-now-/.test(demo.url())) errors.push('Run report now did not open the new report: ' + demo.url());
await demo.goto('http://app.test/#reports'); await demo.waitForTimeout(500);
if (await demo.locator('main table.grid a[href^="#reports/"]').count() !== beforeRuns + 1) errors.push('run-now report not in the list');
await demo.screenshot({ path: path.join(out, 'demo-reports.png'), fullPage: true });
// Applications in the practice camp: a sibling is matched to the family already there; a new family is accepted; one is waitlisted.
await demo.goto('http://app.test/#applications'); await demo.waitForTimeout(500);
if (!/To review \(2\)/.test(await demo.locator('main').innerText())) errors.push('applications to review not counted');
await demo.screenshot({ path: path.join(out, 'demo-applications.png'), fullPage: true });
await demo.goto('http://app.test/#applications/app-2'); await demo.waitForTimeout(500);
if (!(await demo.locator('[data-into]').count())) errors.push('sibling application not matched to the existing family');
await demo.screenshot({ path: path.join(out, 'demo-application-match.png'), fullPage: true });
const famBefore = await demo.locator('[data-into]').first().getAttribute('data-into');
await demo.locator('[data-into]').first().click(); await demo.waitForTimeout(500);
if (!/Accepted/.test(await demo.locator('h1').innerText())) errors.push('sibling not accepted');
await demo.goto('http://app.test/#applications/app-1'); await demo.waitForTimeout(500);
await demo.locator('#acc').click(); await demo.waitForTimeout(500);
await demo.locator('#seefam').click(); await demo.waitForTimeout(700);
if (!/Shimon Goldberg/.test(await demo.locator('main').innerText())) errors.push('accepted camper not in the roster: ' + demo.url());
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(600);
if (!/Goldberg/.test(await demo.locator('main').innerText())) errors.push('new family missing from roster');
await demo.goto('http://app.test/#applications/setup'); await demo.waitForTimeout(400);
await demo.locator('#r_close').fill('2027-05-31');
await demo.locator('[data-bmode="camper.hebrew_name"]').selectOption('hidden');
await demo.locator('[data-addq="camper"]').click(); await demo.waitForTimeout(100);
await demo.locator('#qs_camper li[data-qid] [data-q="label"]').last().fill('T-shirt size');
await demo.locator('#qs_camper li[data-qid] [data-q="type"]').last().selectOption('choice');
await demo.locator('#qs_camper li[data-qid] [data-q="options"]').last().fill('S\nM\nL');
await demo.locator('[data-addq="family"]').click(); await demo.waitForTimeout(100);
await demo.locator('#qs_family li[data-qid] [data-q="label"]').last().fill('Which shul?');
await demo.locator('#addplan').click(); await demo.waitForTimeout(100);
await demo.locator('.plan [data-p="name"]').last().fill('Pay in full'); await demo.locator('.plan [data-p="link"]').last().fill('http://insecure.example.com');
await demo.locator('#regf button.primary').click(); await demo.waitForTimeout(300);
if (!/must start with https/.test(await demo.locator('.toast').last().innerText().catch(() => ''))) errors.push('insecure payment link accepted');
await demo.locator('.plan [data-p="link"]').last().fill('https://pay.example.com');
await demo.screenshot({ path: path.join(out, 'demo-registration-setup.png'), fullPage: true });
await demo.locator('#regf button.primary').click(); await demo.waitForTimeout(400);
if (!/until 2027-05-31/.test(await demo.locator('main').innerText())) errors.push('registration settings not saved: ' + (await demo.locator('.toast').last().innerText().catch(() => '')) + ' ' + demo.url());
await demo.goto('http://app.test/#applications/setup'); await demo.waitForTimeout(400);
const qs = await demo.locator('li[data-qid] [data-q="label"]').evaluateAll(x => x.map(i => i.value));
if (qs.join('|') !== 'Which shul?|T-shirt size' && qs.join('|') !== 'T-shirt size|Which shul?') errors.push('questions not kept: ' + qs.join('|'));
if ((await demo.locator('[data-bmode="camper.hebrew_name"]').inputValue()) !== 'hidden') errors.push('Not asked not kept');
await demo.goto('http://app.test/#roster'); await demo.waitForTimeout(500);
// Staff: applications tab, hiring with chosen positions, a returning staff member matched, the staff roster.
await demo.goto('http://app.test/#applications'); await demo.waitForTimeout(400);
await demo.locator('[data-kind="staff"]').click(); await demo.waitForTimeout(400);
if (!/Yehuda Adler/.test(await demo.locator('main').innerText())) errors.push('staff applications not listed');
await demo.goto('http://app.test/#applications/sapp-1'); await demo.waitForTimeout(500);
if (!(await demo.locator('[data-taxview]').count())) errors.push('director cannot view tax form');
await demo.screenshot({ path: path.join(out, 'demo-staff-application.png'), fullPage: true });
await demo.locator('[data-hpos][value="Counselor"]').uncheck();
await demo.locator('#hire').click(); await demo.waitForTimeout(500);
if (!/Hired/.test(await demo.locator('h1').innerText())) errors.push('staff not hired');
await demo.goto('http://app.test/#applications/sapp-3'); await demo.waitForTimeout(500);
if (!(await demo.locator('[data-hinto]').count())) errors.push('returning staff not matched');
await demo.goto('http://app.test/#staffroster'); await demo.waitForTimeout(500);
await demo.locator('#spos').selectOption('Lifeguard'); await demo.waitForTimeout(400);
const lg = await demo.locator('main tbody tr').count(), lgText = await demo.locator('main').innerText();
if (!/Yehuda Adler/.test(lgText) || lg < 2) errors.push('hired lifeguard not on the staff roster: ' + lg);
await demo.screenshot({ path: path.join(out, 'demo-staff-roster.png'), fullPage: true });
await demo.locator('#addstaff').click(); await demo.waitForTimeout(400);
await demo.locator('[data-m="first_name"]').fill('Hired'); await demo.locator('[data-m="last_name"]').fill('Elsewhere');
await demo.locator('[data-mpos][value="Kitchen staff"]').check(); await demo.locator('#smf button.primary').click(); await demo.waitForTimeout(500);
if (!/Hired Elsewhere/.test(await demo.locator('h1').innerText())) errors.push('staff member not added: ' + demo.url());
await demo.goto('http://app.test/#applications/setup-staff'); await demo.waitForTimeout(400);
if (!(await demo.locator('#r_pos').count()) || await demo.locator('#addplan').count()) errors.push('staff setup page wrong');
await demo.locator('#r_pos').fill('Lifeguard\nWaiter\nArts and crafts'); await demo.locator('#regf button.primary').click(); await demo.waitForTimeout(400);
await demo.goto('http://app.test/#applications/sapp-2'); await demo.waitForTimeout(400);
if (!(await demo.locator('[data-hpos][value="Arts and crafts"]').count())) errors.push('new position not offered when hiring');
await viewAs('counselor@bunk-boys-1');
if (/Staff roster/.test(await nav())) errors.push('counselor sees the staff roster');
if (/Applications/.test(await nav())) errors.push('counselor sees Applications');
if (/Reports/.test(await nav())) errors.push('counselor sees Reports');
await viewAs('office');
if (!/Reports/.test(await nav())) errors.push('office does not see Reports');
await viewAs('director');

// A camper link from another camp says so instead of failing.
await demo.goto('http://app.test/#camper/00000000-0000-0000-0000-000000000999'); await demo.waitForTimeout(400);
if (!/Camper not found/.test(await demo.locator('main').innerText())) errors.push('missing camper page not handled');
if (serverCalls.length) errors.push('test camp called the server: ' + serverCalls.slice(0, 3).join(', '));

await browser.close();
if (errors.length) { console.error('PAGE CHECK FAILED:\n' + errors.join('\n')); process.exit(1); }
console.log('All pages opened without script errors. Screenshots in tests/browser/out/');
