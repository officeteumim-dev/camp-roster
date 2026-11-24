import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToIso, reportDue, zoned, buildReportEmail, reportColumns, REPORT_COLUMNS, REPORT_DEFAULT } from '../supabase/functions/_shared/reports.js';

const NY = 'America/New_York';
test('local New York times to exact moments, across daylight saving', () => {
  assert.equal(localToIso('2026-11-05T14:30:00', NY), '2026-11-05T19:30:00.000Z');   // EST
  assert.equal(localToIso('2027-07-01T08:00:00', NY), '2027-07-01T12:00:00.000Z');   // EDT
  assert.equal(localToIso('2026-11-01T08:00:00', NY), '2026-11-01T13:00:00.000Z');   // the day clocks go back
  assert.equal(localToIso(null, NY), null);
});

test('8 a.m. report: daily, never Saturday, Sunday covers 48 hours, Monday 24', () => {
  // Mon Nov 16 2026, 8:05 a.m. EST = 13:05 UTC
  const mon = reportDue(new Date('2026-11-16T13:05:00Z'), NY, '2026-11-15T13:00:00.000Z');
  assert.deepEqual(mon, { due: true, date: '2026-11-16', from: '2026-11-15T13:00:00.000Z', to: '2026-11-16T13:00:00.000Z' });
  assert.equal(reportDue(new Date('2026-11-16T12:05:00Z'), NY, null).due, false, '7 a.m.: not yet');
  assert.equal(reportDue(new Date('2026-11-16T14:05:00Z'), NY, null).due, false, '9 a.m.: past the hour');
  assert.equal(reportDue(new Date('2026-11-21T13:05:00Z'), NY, null).due, false, 'Saturday: none');
  const sun = reportDue(new Date('2026-11-22T13:05:00Z'), NY, '2026-11-20T13:00:00.000Z');
  assert.equal(sun.from, '2026-11-20T13:00:00.000Z', 'Sunday picks up from Friday 8 a.m.');
  assert.equal((new Date(sun.to) - new Date(sun.from)) / 3600e3, 48);
  const firstSun = reportDue(new Date('2026-11-22T13:05:00Z'), NY, null);
  assert.equal((new Date(firstSun.to) - new Date(firstSun.from)) / 3600e3, 48, 'Sunday with no earlier report: 48 hours');
  assert.equal(reportDue(new Date('2026-11-16T13:30:00Z'), NY, null, { lastDate: '2026-11-16' }).due, false, 'only once a day');
  // Summer (EDT): 8 a.m. is 12:00 UTC.
  assert.equal(reportDue(new Date('2027-07-06T12:02:00Z'), NY, null).due, true);
  assert.equal(zoned(new Date('2027-07-06T12:02:00Z'), NY).h, 8);
});

test('report email: one row per new camper, with the columns the director chose', () => {
  const data = { from: '2026-11-15T13:00:00Z', to: '2026-11-16T13:00:00Z', campers: 3, families: 2, new_families: 1, list: [
    { last_name: 'Cohen', parents: 'Dovid', new_family: false, city: 'Monsey', state: 'New York', applied_at: '2026-11-15T20:10:00Z', phone: '(845) 555-0201', email: 'd@example.org',
      campers: [{ name: 'Baruch Cohen', grade: '6th', dob: '2014-12-01', sessions: ['First Half'], fields: { f_shirt: 'Youth L' } }] },
    { last_name: 'Katz', parents: 'Ari & Dina', new_family: true, campers: [{ name: 'Avi Katz', grade: null, sessions: [] }, { name: 'Eli Katz', grade: '9th', sessions: ['First Half', 'Second Half'] }] }] };
  const e = buildReportEmail({ name: 'Camp Teumim' }, data, 'https://roster.example');
  assert.equal(e.subject, 'Camp Teumim: 3 new campers (Mon, Nov 16)');
  assert.match(e.text, /3 new campers from 2 families \(1 new to camp\)/);
  assert.match(e.text, /- Baruch Cohen, 6th, First Half, Dovid, Monsey, New York, Nov 15, Sibling added/);
  assert.match(e.text, /Eli Katz, 9th, First Half & Second Half, Ari & Dina/);
  assert.match(e.text, /Sun, Nov 15, 8:00 AM to Mon, Nov 16, 8:00 AM/);
  assert.match(e.html, /<th[^>]*>Camper<\/th><th[^>]*>Grade<\/th><th[^>]*>Sessions<\/th>/);
  assert.doesNotMatch(e.html, /d@example.org/, 'email not shown unless chosen');

  const cols = reportColumns(['phone', 'age', 'f_shirt', 'nonsense'], { f_shirt: 'T-shirt size' });
  assert.deepEqual(cols.map(c => c.label), ['Camper', 'Phone', 'Age', 'T-shirt size'], 'the name is added when no name column is chosen');
  const e2 = buildReportEmail({ name: 'Camp Teumim' }, data, 'https://roster.example', 'America/New_York', cols);
  assert.match(e2.text, /- Baruch Cohen, \(845\) 555-0201, 11, Youth L/);
  assert.match(e2.html, /<th[^>]*>T-shirt size<\/th>/);

  const none = buildReportEmail({ name: 'Camp Teumim' }, { ...data, campers: 0, families: 0, new_families: 0, list: [] }, 'https://roster.example');
  assert.match(none.subject, /no new registrations/);
});

test('the app offers the same report columns as the email', async () => {
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('var REPORT_COLUMNS = ['), app.indexOf('var REPORT_DEFAULT'));
  const keys = [...block.matchAll(/^\s*\['(\w+)', '([^']+)'/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(keys, REPORT_COLUMNS.map(c => [c[0], c[1]]));
  assert.match(app, new RegExp("var REPORT_DEFAULT = " + JSON.stringify(REPORT_DEFAULT).replace(/"/g, "'").replace(/[[\]]/g, '\\$&').replace(/,/g, ', ')));
});

test('every Roster column can be a report column', async () => {
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('var ROSTER_COLS = ['), app.indexOf('var ROSTER_DEFAULT'));
  const roster = [...block.matchAll(/^\s*\['\w+', '([^']+)'/gm)].map(m => m[1]);
  assert.ok(roster.length > 20);
  const report = REPORT_COLUMNS.map(c => c[1]);
  assert.deepEqual(roster.filter(l => !report.includes(l)), []);
  assert.deepEqual(reportColumns(['grade']).map(c => c.key), ['name', 'grade'], 'a report always says who');
});

test('campers not approved yet are counted and noted', () => {
  const data = { from: '2026-11-23T13:00:00Z', to: '2026-11-24T13:00:00Z', campers: 2, families: 1, new_families: 1, list: [
    { last_name: 'Levi', parents: 'Moshe', new_family: true, campers: [{ name: 'Dovi Levi', approval_status: 'Pending' }, { name: 'Avi Levi', approval_status: 'Approved' }] }] };
  const e = buildReportEmail({ name: 'Camp' }, data, 'https://x', 'America/New_York', reportColumns(['name', 'grade']));
  assert.match(e.text, /2 new campers from 1 family \(1 new to camp\), 1 not approved yet\./);
  assert.match(e.text, /- Dovi Levi \(not approved yet\)/);
  assert.doesNotMatch(e.text, /Avi Levi \(not approved/);
  assert.match(e.html, /<tr style="background:#fbf6e9"><td[^>]*><strong>Dovi Levi<\/strong> <span[^>]*>\(not approved yet\)/);
});
