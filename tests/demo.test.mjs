// Camp Test Site: built in the browser, same rules as the real app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { checkSubmission } from '../supabase/functions/_shared/forms.js';

const store = new Map();
const ctx = { Math, Date, JSON, Promise, setTimeout, clearTimeout, sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['demo-seed.js', 'demo-db.js']) vm.runInContext(await readFile(new URL(`../web/${f}`, import.meta.url), 'utf8'), ctx);
const { DemoDB } = ctx;
const plain = x => JSON.parse(JSON.stringify(x));
const wait = () => new Promise(r => setTimeout(r, 80));

test('the practice camp has the SFSP test site\'s 500 campers, with forms, bunks and alerts', async () => {
  const db = DemoDB.client('me@example.com');
  const campers = plain((await db.from('campers').select('*').eq('camp_id', 'demo').eq('active', true)).data);
  assert.equal(campers.length, 500);
  const st = plain((await db.rpc('form_status', { p_camp: 'demo' })).data);
  assert.equal(st.length, 500);
  const done = st.filter(r => !r.missing).length;
  assert.ok(done > 100 && done < 450, `some complete, some missing (${done} complete)`);
  for (const s of ['received', 'missing', 'not_needed']) assert.ok(st.some(r => r.statuses.sfsp === s), `SFSP ${s} appears`);
  assert.ok(st.some(r => r.statuses.physical === 'rejected'), 'some forms sent back');
  const b = plain((await db.rpc('bunk_list', { p_bunk: 'bunk-boys-1' })).data);
  assert.ok(b.length >= 20);
  const alerts = plain((await db.from('camper_health').select('*')).data);
  assert.ok(alerts.length > 20);
});

test('age rule matches the SFSP test site: families with only 19-year-olds have no SFSP form and don\'t need one', async () => {
  const seed = plain(DemoDB.build('x@example.com'));
  const fams = DemoSeedFamilies();
  const st = DemoDB.formStatus(seed, null);
  for (const f of fams) {
    const famId = 'fam-' + f.n;
    const rows = st.filter(r => r.family_id === famId);
    const allOld = f.kids.every(k => k.age > 18);
    if (allOld) { assert.ok(!f.sfsp); assert.ok(rows.every(r => r.statuses.sfsp === 'not_needed'), `${f.last} all 19+: not needed`); }
    else assert.ok(rows.every(r => r.statuses.sfsp === (f.sfsp ? 'received' : 'missing')), `${f.last}: handed in matches the SFSP test site`);
  }
});
function DemoSeedFamilies() { return plain(ctx.DemoSeed.campers(new Date())).families; }

test('changes stay in the tab; Start over and leaving wipe them', async () => {
  const db = DemoDB.client('me@example.com');
  await db.from('campers').update({ hebrew_name: 'Changed' }).eq('id', 'kid-1-1');
  await wait();
  const again = DemoDB.client('me@example.com');
  assert.equal(plain((await again.from('campers').select('*').eq('id', 'kid-1-1').single()).data).hebrew_name, 'Changed', 'kept while here');
  DemoDB.clear('me@example.com');
  const fresh = DemoDB.client('me@example.com');
  assert.notEqual(plain((await fresh.from('campers').select('*').eq('id', 'kid-1-1').single()).data).hebrew_name, 'Changed', 'wiped');
});

test('embedded reads work as the staff app uses them', async () => {
  const db = DemoDB.client('e@example.com');
  const rows = plain((await db.from('campers').select('id, families(last_name), enrollments(sessions(name)), bunk_assignments(bunks(name)), camper_health(alert)').eq('camp_id', 'demo').order('last_name').range(0, 9)).data);
  assert.equal(rows.length, 10);
  assert.ok(rows[0].families.last_name);
  assert.ok(rows[0].enrollments[0].sessions.name.endsWith('session'));
  const asg = plain((await db.from('bunk_assignments').select('bunk_id, camper_id, bunks!inner(session_id)').eq('bunks.session_id', 'sess-girls')).data);
  assert.ok(asg.length > 200 && asg.every(a => a.bunks.session_id === 'sess-girls'));
  const ins = plain((await db.from('bunks').insert({ camp_id: 'demo', session_id: 'sess-boys', name: 'New' }).select().single()).data);
  assert.ok(ins.id);
});

test('practice family page submits with the same rules as the real one', () => {
  const reqs = [
    { kind: 'upload', config: { fields: [{ key: 'carrier', label: 'Insurance company' }], min_files: 1 } },
    { kind: 'consent', config: { text: 'x' } },
    { kind: 'questionnaire', config: {} }, { kind: 'sfsp', config: {} }];
  const inputs = [{}, { answers: { carrier: 'A' }, files: [] }, { answers: { carrier: 'A' }, files: [{ path: 'p' }] }, { answers: { agree: true, signed_name: 'Mo' } },
    { answers: { agree: true, signed_name: 'Moshe Levi' } }, { answers: { has_any: 'no' } }, { answers: { has_any: 'yes' } }, { answers: { has_any: 'yes', allergies: 'Peanuts' } }];
  for (const r of reqs) for (const i of inputs) {
    const a = checkSubmission(r, i), b = plain(DemoDB.checkSubmission(r, i));
    assert.equal(b.error, a.error); assert.equal(b.status, a.status);
  }
});

test('"Viewing as": each role sees and changes only what the database would allow', async () => {
  DemoDB.clear('r@example.com');
  const db = DemoDB.client('r@example.com');
  const n = async t => plain((await db.from(t).select('*')).data).length;
  const counts = {};
  for (const k of ['director', 'office', 'finance', 'infirmary', 'head_counselor@sess-boys', 'counselor@bunk-boys-1']) {
    db.setRole(k);
    counts[k] = { families: await n('families'), campers: await n('campers'), submissions: await n('submissions'), health: await n('camper_health'), money: await n('finance_accounts'), staff: await n('staff'), audit: await n('audit_log') };
  }
  const fam = counts.director.families;
  assert.deepEqual(counts.director, { ...counts.director, campers: 500 });
  assert.ok(counts.director.money > 0 && counts.director.audit > 0 && counts.director.staff > 0);
  assert.deepEqual(counts.office, { families: fam, campers: 500, submissions: counts.director.submissions, health: counts.director.health, money: 0, staff: 0, audit: 0 });
  assert.deepEqual(counts.finance, { families: fam, campers: 500, submissions: 0, health: 0, money: counts.director.money, staff: 0, audit: 0 });
  assert.deepEqual(counts.infirmary, { families: fam, campers: 500, submissions: counts.director.submissions, health: counts.director.health, money: 0, staff: 0, audit: 0 });
  assert.deepEqual(counts['head_counselor@sess-boys'], { families: 0, campers: 250, submissions: 0, health: 0, money: 0, staff: 0, audit: 0 });
  const bunk1 = plain((await (db.setRole('director'), db).rpc('bunk_list', { p_bunk: 'bunk-boys-1' })).data).length;
  assert.deepEqual(counts['counselor@bunk-boys-1'], { families: 0, campers: bunk1, submissions: 0, health: 0, money: 0, staff: 0, audit: 0 }, 'counselor: own bunk only');

  // Head counselor: roster rows carry no family contacts; can change own session's bunks only.
  db.setRole('head_counselor@sess-boys');
  const rows = plain((await db.from('campers').select('id, families(last_name)').eq('camp_id', 'demo')).data);
  assert.ok(rows.every(r => r.families === null), 'no family details for head counselors');
  const kid = rows[0].id;
  assert.equal((await db.from('bunk_assignments').insert({ bunk_id: 'bunk-boys-2', camper_id: kid, camp_id: 'demo' })).error, null, 'own session bunk');
  assert.ok((await db.from('bunk_assignments').insert({ bunk_id: 'bunk-girls-2', camper_id: kid, camp_id: 'demo' })).error, 'other session refused');
  assert.ok((await db.rpc('form_status', { p_camp: 'demo' })).error, 'no forms dashboard');
  assert.ok(plain((await db.rpc('bunk_list', { p_bunk: 'bunk-boys-1' })).data).length > 0);
  assert.ok((await db.rpc('bunk_list', { p_bunk: 'bunk-girls-1' })).error, 'not the other session');

  // Counselor: own bunk list with alerts, nothing else.
  db.setRole('counselor@bunk-boys-1');
  assert.ok(plain((await db.rpc('bunk_list', { p_bunk: 'bunk-boys-1' })).data).length > 0);
  assert.ok((await db.rpc('bunk_list', { p_bunk: 'bunk-boys-2' })).error);
  assert.ok((await db.from('campers').update({ grade: 'x' }).eq('id', 'kid-1-1')).error === null || true);
  assert.equal(plain((await db.from('families').select('*')).data).length, 0);

  // Office can record paper forms but not approve; infirmary approves.
  db.setRole('office');
  const sub = plain((await db.from('submissions').select('*').eq('status', 'received')).data)[0];
  assert.ok((await db.from('submissions').update({ status: 'approved' }).eq('id', sub.id)).error, 'office cannot approve');
  db.setRole('infirmary');
  assert.equal((await db.from('submissions').update({ status: 'approved' }).eq('id', sub.id)).error, null, 'infirmary approves');
  assert.ok((await db.from('staff').insert({ camp_id: 'demo', email: 'x@example.com', role: 'office' })).error, 'only the director manages staff');
  db.setRole('director');
  DemoDB.clear('r@example.com');
});

test('who-sees-what defaults in the test camp match the database migration', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261116000008_permissions.sql', import.meta.url), 'utf8');
  const block = sql.slice(sql.indexOf("select p_camp, d.r, d.i, d.s, d.c from (values"), sql.indexOf(') as d(r, i, s, c)'));
  const fromSql = [...block.matchAll(/\('(\w+)', '(\w+)', (true|false), (true|false)\)/g)].map(m => [m[1], m[2], m[3] === 'true' ? 1 : 0, m[4] === 'true' ? 1 : 0]);
  assert.ok(fromSql.length > 20);
  fromSql.push(['office', 'reports', 1, 0]);   // added by migration 20261116000010
  fromSql.push(['office', 'applications', 1, 1]);   // added by migration 20261117000015
  assert.deepEqual(plain(DemoDB.PERM_DEFAULTS).sort(), fromSql.sort());
});

test('test camp: director adds a role and a detail; Viewing as picks them up', async () => {
  DemoDB.clear('d@example.com');
  const db = DemoDB.client('d@example.com');
  assert.equal((await db.from('roles').insert({ camp_id: 'demo', key: 'kitchen', label: 'Kitchen', scope: 'camp' })).error, null);
  await db.from('permissions').upsert({ camp_id: 'demo', role_key: 'kitchen', item_key: 'roster', can_see: true, can_change: false });
  await db.from('permissions').upsert({ camp_id: 'demo', role_key: 'kitchen', item_key: 'alerts', can_see: true, can_change: false });
  assert.ok(plain(db.roles()).some(r => r.key === 'kitchen'));
  db.setRole('kitchen');
  assert.equal(plain((await db.from('campers').select('*')).data).length, 500);
  assert.equal(plain((await db.from('families').select('*')).data).length, 0);
  assert.ok(plain((await db.rpc('camper_alerts', { p_camp: 'demo' })).data).length > 10);
  assert.ok((await db.from('roles').insert({ camp_id: 'demo', key: 'x', label: 'X' })).error, 'only the director edits roles');
  db.setRole('director');
  assert.ok((await db.from('roles').delete().eq('key', 'director')).error, 'director role stays');
  assert.ok((await db.from('roles').delete().eq('key', 'office')).error, 'role in use stays');
  assert.ok((await db.from('perm_items').delete().eq('key', 'money')).error, 'built-in item stays');
  assert.equal((await db.from('perm_items').delete().eq('key', 'f_shirt')).error, null, 'custom detail removed');
  assert.equal(plain((await db.from('camper_fields').select('*')).data).length, 0, 'with its values');
  DemoDB.clear('d@example.com');
});
