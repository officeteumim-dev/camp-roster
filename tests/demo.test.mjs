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
