import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSubmission, uploadPath, pathBelongs } from '../supabase/functions/_shared/forms.js';

const insurance = { kind: 'upload', config: { fields: [{ key: 'carrier', label: 'Insurance company' }, { key: 'group', label: 'Group', optional: true }], min_files: 1 } };

test('uploads need their fields and a file', () => {
  assert.match(checkSubmission(insurance, { answers: {}, files: [{ path: 'p' }] }).error, /Insurance company/);
  assert.match(checkSubmission(insurance, { answers: { carrier: 'Aetna' }, files: [] }).error, /photo or file/);
  const ok = checkSubmission(insurance, { answers: { carrier: ' Aetna ', extra: 'x' }, files: [{ path: 'p' }] });
  assert.equal(ok.status, 'received');
  assert.deepEqual(ok.answers, { carrier: 'Aetna' }, 'only known fields kept');
});

test('consent needs the box and a typed name', () => {
  const r = { kind: 'consent', config: { text: 'I agree' } };
  assert.ok(checkSubmission(r, { answers: { signed_name: 'Moshe Levi' } }).error);
  assert.ok(checkSubmission(r, { answers: { agree: true, signed_name: 'M' } }).error);
  const ok = checkSubmission(r, { answers: { agree: true, signed_name: 'Moshe Levi' } });
  assert.equal(ok.status, 'received');
  assert.equal(ok.answers.text, 'I agree');
});

test('medical history: "no" means not needed; "yes" needs details', () => {
  const r = { kind: 'questionnaire', config: {} };
  assert.equal(checkSubmission(r, { answers: { has_any: 'no' } }).status, 'not_needed');
  assert.ok(checkSubmission(r, { answers: {} }).error);
  assert.ok(checkSubmission(r, { answers: { has_any: 'yes' } }).error);
  const ok = checkSubmission(r, { answers: { has_any: 'yes', allergies: 'Peanuts', epipen: true } });
  assert.equal(ok.status, 'received');
  assert.equal(ok.answers.epipen, true);
});

test('SFSP is never submitted here', () => {
  assert.ok(checkSubmission({ kind: 'sfsp' }, {}).error);
});

test('upload paths stay inside the family folder', () => {
  const p = uploadPath('c1', 'f1', 'b1', 0, '../../My Physical (1).PDF');
  assert.equal(p, 'c1/f1/b1/0-My_Physical_1_.PDF');
  assert.ok(pathBelongs(p, 'c1', 'f1'));
  assert.ok(!pathBelongs('c1/f2/b1/0-a.pdf', 'c1', 'f1'));
  assert.ok(!pathBelongs('c1/f1/../f2/a.pdf', 'c1', 'f1'));
});
