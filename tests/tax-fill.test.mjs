// The W-4 / W-9 filler: right fields for the current IRS versions, checks, and refusing a changed form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.self = globalThis;
new Function(readFileSync(new URL('../web/vendor/pdf-lib-1.17.1.min.js', import.meta.url), 'utf8')).call(globalThis);
new Function(readFileSync(new URL('../web/tax-fill.js', import.meta.url), 'utf8'))();
const { PDFLib, TaxFill } = globalThis;
const w4 = readFileSync(new URL('../web/irs/fw4.pdf', import.meta.url)), w9 = readFileSync(new URL('../web/irs/fw9.pdf', import.meta.url));
const when = { date: '11/17/2026', stamp: 'Nov 17, 2026 9:30 AM EST' };
const quiet = fn => async () => { const w = console.warn; console.warn = () => {}; try { await fn(); } finally { console.warn = w; } };

test('every mapped field exists in the downloaded IRS forms', async () => {
  for (const [bytes, map] of [[w4, TaxFill.W4], [w9, TaxFill.W9]]) {
    const names = (await PDFLib.PDFDocument.load(bytes)).getForm().getFields().map(f => f.getName());
    for (const k of Object.keys(map)) assert.ok(names.includes(map[k]), k + ' ' + map[k]);
  }
});

test('Social Security numbers', () => {
  assert.ok(TaxFill.validSsn('123-45-6789'));
  assert.ok(TaxFill.validSsn('123 45 6789'));
  for (const bad of ['12345678', '000-12-3456', '666-12-3456', '900-12-3456', '123-00-4567', '123-45-0000']) assert.ok(!TaxFill.validSsn(bad), bad);
  assert.deepEqual(TaxFill.step3({ kids: 2, otherDeps: 1 }), { c: 4400, o: 500, total: 4900 });
});

test('fills and flattens a W-4 and a W-9', quiet(async () => {
  const a4 = await TaxFill.fill(PDFLib, w4, 'W-4', { first: 'Avi', middle: 'm', last: 'Stein', address: '1 Main St', cityStateZip: 'Lakewood, NJ 08701', ssn: '123456789', status: 'single', exempt: true, signature: 'Avi Stein', email: 'a@example.com' }, when);
  const a9 = await TaxFill.fill(PDFLib, w9, 'W-9', { name: 'Avi Stein', address: '1 Main St', cityStateZip: 'Lakewood, NJ 08701', ssn: '123-45-6789', requester: 'Camp', signature: 'Avi Stein', email: 'a@example.com' }, when);
  for (const out of [a4, a9]) {
    const doc = await PDFLib.PDFDocument.load(out);
    assert.equal(doc.getForm().getFields().length, 0, 'flattened: nothing left to edit');
    assert.match(doc.getTitle(), /^Form W-[49] - Avi Stein$/);
  }
}));

test('refuses a form whose fields have changed', quiet(async () => {
  await assert.rejects(TaxFill.fill(PDFLib, w9, 'W-4', { ssn: '123456789', signature: 'x', email: 'x' }, when), /W-4 version has changed/);
}));
