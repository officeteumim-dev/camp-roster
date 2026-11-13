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
    my_access: [{ camp_id: 'c1', camp_name: camp.name, role: 'director' }, { camp_id: 'c1', camp_name: camp.name, role: 'infirmary' }, { camp_id: 'c1', camp_name: camp.name, role: 'counselor', session_id: 's1', bunk_id: 'b1' }],
    form_status: status,
    bunk_list: [{ camper_id: 'k1', first_name: 'Yosef', last_name: 'Levi', grade: '8th', alert: 'Peanut allergy, EpiPen' }],
    sfsp_connection: { sfsp_camp_id: 'abc', sfsp_form_url: 'https://www.wgcamps.com/apply.html', has_secret: true },
    log_file_view: null
  },
  tables: {
    camps: [camp], requirements: reqs,
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
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      try { return route.fulfill({ contentType: type, body: await readFile(file) }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  return page;
}

const page = await newPage(1360);
for (const h of ['roster', 'forms', 'camper/k1', 'bunks', 'mybunk', 'money', 'imports', 'settings', 'activity']) {
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

// Camp Test Site, as a new user with no camp yet: explore, roster of 500, family page practice, nothing sent anywhere.
const NEW = JSON.parse(JSON.stringify(FAKE)); NEW.rpc.my_access = []; NEW.session.user.email = 'new@example.com';
const demo = await newPage(1360, NEW);
const serverCalls = [];
demo.on('request', r => { const u = r.url(); if (u.includes('fake.supabase.co')) serverCalls.push(u); });
await demo.goto('http://app.test/'); await demo.waitForTimeout(300);
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
await demo.locator('#se').fill('trial@example.com'); await demo.locator('#addstaff button.primary').click(); await demo.waitForTimeout(200);
let staffText = await demo.locator('main').innerText();
if (!/trial@example.com/.test(staffText)) errors.push('test camp: adding staff did not show');
await demo.locator('#demoreset').click(); await demo.waitForTimeout(500);
await demo.goto('http://app.test/#settings'); await demo.waitForTimeout(400);
staffText = await demo.locator('main').innerText();
if (/trial@example.com/.test(staffText)) errors.push('Start over did not wipe changes');
if (serverCalls.length) errors.push('test camp called the server: ' + serverCalls.slice(0, 3).join(', '));

await browser.close();
if (errors.length) { console.error('PAGE CHECK FAILED:\n' + errors.join('\n')); process.exit(1); }
console.log('All pages opened without script errors. Screenshots in tests/browser/out/');
