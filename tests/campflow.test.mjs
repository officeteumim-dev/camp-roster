// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readXlsx } from '../supabase/functions/_shared/xlsx.js';
import * as CF from '../supabase/functions/_shared/campflow.js';

const fx = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));

test('reads the families report, including HYPERLINK family links', async () => {
  const { rows } = await readXlsx(await fx('families.xlsx'));
  assert.equal(CF.detectReport(rows[0]), 'families');
  const { families, problems } = CF.parseFamilies(rows);
  assert.equal(problems.length, 0);
  assert.equal(families.length, 3);
  const levi = families[0];
  assert.equal(levi.external_id, 'campflow:10001');
  assert.deepEqual(levi.camper_names, ['Yosef', 'Chaim']);
  assert.equal(levi.family.father_email, 'moshe@example.org');
  assert.equal(levi.family.disclosures['Medical Authorization'], 'Yes');
  assert.equal(levi.family.applied_at, '2026-11-05T14:30:00');
  assert.equal(levi.finance.balance_cents, 220000);
  assert.equal(families[1].finance.balance_cents, null, 'blank money stays blank');
  assert.equal(families[1].family.mother_email, null);
});

test('reads the campers and transactions reports', async () => {
  const c = await readXlsx(await fx('campers.xlsx'));
  assert.equal(CF.detectReport(c.rows[0]), 'campers');
  const { campers } = CF.parseCampers(c.rows);
  assert.equal(campers.length, 4);
  assert.deepEqual(campers[0].sessions, ['First Half', 'Second Half']);
  assert.equal(campers[0].date_of_birth, '2013-03-14');
  assert.equal(campers[1].date_of_birth, '2015-07-02');
  assert.equal(campers[2].date_of_birth, '2014-03-02', 'Excel date number');
  assert.equal(campers[2].external_id, 'campflow:camper:503');
  assert.equal(campers[0].legal_first, 'Joseph');
  assert.equal(campers[0].hebrew_name, 'Yosef');
  assert.equal(campers[0].staff_child, false);
  assert.equal(campers[1].legal_first, null, 'blank legal name is not used');
  assert.equal(campers[1].staff_child, true);
  const t = await readXlsx(await fx('transactions.xlsx'));
  assert.equal(CF.detectReport(t.rows[0]), 'transactions');
  const { entries } = CF.parseTransactions(t.rows);
  assert.deepEqual(entries.map(e => [e.kind, e.amount_cents]), [['charge', 160000], ['payment', 100000], ['discount', 20000]]);
});

test('money and dates', () => {
  assert.equal(CF.moneyCents('$1,250.50'), 125050);
  assert.equal(CF.moneyCents('-$40'), -4000);
  assert.equal(CF.moneyCents('(40.00)'), -4000);
  assert.equal(CF.moneyCents(''), null);
  assert.equal(CF.parseDate('11/05/2026 12:10 am', true), '2026-11-05T00:10:00');
  assert.equal(CF.parseDate('11/05/2026 12:10 pm', true), '2026-11-05T12:10:00');
  assert.equal(CF.parseDate('not a date'), null);
});

test('family import plan: adds, updates, flags missing families, and refuses to flag on a much smaller report', async () => {
  const { families } = CF.parseFamilies((await readXlsx(await fx('families.xlsx'))).rows);
  const existing = { families: [
    { id: 'F1', external_id: 'campflow:10001', active: true },
    { id: 'F9', external_id: 'campflow:77777', active: true },
    { id: 'F8', external_id: 'campflow:10003', active: false } ] };
  const plan = CF.planFamilies(families, existing);
  assert.deepEqual(plan.insert.map(p => p.external_id), ['campflow:10002']);
  assert.deepEqual(plan.update.map(p => p.id), ['F1', 'F8']);
  assert.deepEqual(plan.deactivate, ['F9']);
  assert.deepEqual(plan.reactivate, ['F8']);
  const small = CF.parseFamilies((await readXlsx(await fx('families_small.xlsx'))).rows).families;
  const many = { families: Array.from({ length: 10 }, (_, i) => ({ id: 'X' + i, external_id: 'campflow:' + (20000 + i), active: true })) };
  const p2 = CF.planFamilies(small, many);
  assert.deepEqual(p2.deactivate, []);
  assert.equal(p2.skippedDeactivation, true);
});

test('campers from names until the camper report exists, then upgraded in place', async () => {
  const { families } = CF.parseFamilies((await readXlsx(await fx('families.xlsx'))).rows);
  const ids = new Map([['campflow:10001', 'F1'], ['campflow:10002', 'F2'], ['campflow:10003', 'F3']]);
  const existing = [{ id: 'C1', family_id: 'F1', first_name: 'yosef', derived: true, active: true },
                    { id: 'C2', family_id: 'F1', first_name: 'Menachem', derived: true, active: true }];
  const d = CF.planDerivedCampers(families, ids, existing);
  assert.deepEqual(d.insert.map(c => c.first_name).sort(), ['Chaim', 'Eli', 'Shmuel']);
  assert.deepEqual(d.deactivate, ['C2']);

  const { campers } = CF.parseCampers((await readXlsx(await fx('campers.xlsx'))).rows);
  const p = CF.planCampers(campers, ids, [{ id: 'C1', family_id: 'F1', first_name: 'Yosef', external_id: null, derived: true }]);
  assert.equal(p.update.length, 1);
  assert.equal(p.update[0].id, 'C1');
  assert.equal(p.update[0].external_id, 'campflow:camper:501');
  assert.equal(p.update[0].legal_first, 'Joseph');
  assert.ok(!('legal_first' in p.insert.find(c => c.first_name === 'Chaim')), 'missing legal name leaves what is on file');
  assert.equal(p.insert.length, 2);
  assert.equal(p.problems.length, 1, 'camper whose family is unknown');
});

test('the real Camp Flow report, if present locally (never committed)', async t => {
  const path = process.env.CAMPFLOW_SAMPLE;
  if (!path) return t.skip('set CAMPFLOW_SAMPLE to a real report to check it');
  const { rows } = await readXlsx(await readFile(path));
  assert.equal(CF.detectReport(rows[0]), 'families');
  const { families, problems } = CF.parseFamilies(rows);
  assert.equal(problems.length, 0);
  assert.ok(families.every(f => /^campflow:\d+$/.test(f.external_id)));
  assert.ok(families.every(f => f.camper_names.length >= 1));
  console.log(`real report: ${families.length} families, ${families.reduce((n, f) => n + f.camper_names.length, 0)} campers`);
});

test('camper report with plain Camper ID and Family ID numbers', async () => {
  const { rows } = await readXlsx(await fx('campers_ids.xlsx'));
  assert.equal(CF.detectReport(rows[0]), 'campers');
  const { campers, problems } = CF.parseCampers(rows);
  assert.equal(problems.length, 0);
  assert.equal(campers[0].external_id, 'campflow:camper:501');
  assert.equal(campers[0].family_external_id, 'campflow:10001');
  assert.equal(campers[1].family_external_id, 'campflow:10002');
});
