import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as C from '../supabase/functions/_shared/crypto.js';

test('family tokens are long, random and hashed', async () => {
  const a = C.newToken(), b = C.newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43 && /^[A-Za-z0-9_-]+$/.test(a));
  assert.match(await C.sha256Hex(a), /^[0-9a-f]{64}$/);
});

test('SFSP household reference matches the format in the SFSP brief', async () => {
  const ref = await C.sfspRef('s3cret', 'campflow:12345');
  assert.match(ref, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const [payload, sig] = ref.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { v: 1, h: 'campflow:12345' });
  assert.equal(sig, createHmac('sha256', 's3cret').update(payload).digest('base64url'), 'same as a plain HMAC in Node');
  assert.deepEqual(await C.readSfspRef('s3cret', ref), { h: 'campflow:12345', exp: null });
  assert.equal(await C.readSfspRef('other', ref), null);
  assert.equal(await C.readSfspRef('s3cret', payload + '.x' + sig.slice(1)), null);
});

test('signed messages between the apps', async () => {
  const body = JSON.stringify({ type: 'sfsp.form', camp: 'abc', household: 'campflow:1', form: 'f1', state: 'received' });
  const h = await C.signMessage('k', body, 1_800_000_000);
  assert.equal(h['X-WG-Signature'], 'sha256=' + createHmac('sha256', 'k').update(`1800000000.${body}`).digest('hex'));
  assert.equal(await C.verifyMessage('k', body, h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_100 }), true);
  assert.equal(await C.verifyMessage('k', body + ' ', h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_100 }), false, 'tampered body');
  assert.equal(await C.verifyMessage('k', body, h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_301 }), false, 'more than 300 seconds old');
  assert.equal(await C.verifyMessage('', body, h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_100 }), false, 'no secret');
});

// Test vectors from the SFSP connection spec v1.
const SPEC_SECRET = 'test-secret-DO-NOT-USE-0123456789abcdef';
test('spec v1 test vectors: personal link REF', async () => {
  assert.equal(await C.sfspRef(SPEC_SECRET, 'campflow:12345'), 'eyJ2IjoxLCJoIjoiY2FtcGZsb3c6MTIzNDUifQ.1FOr6b3iMHodO-nDUruXBbRJb3xiRN36gETwh04Uy-k');
  const withExp = 'eyJ2IjoxLCJoIjoiY2FtcGZsb3c6MTIzNDUiLCJleHAiOjE3NjcyMjU1OTl9.jXuQfTPons2GAs0C98VICAjzDfISS5w21LQ2ZUdb8mY';
  assert.equal(await C.sfspRef(SPEC_SECRET, 'campflow:12345', 1767225599), withExp);
  assert.deepEqual(await C.readSfspRef(SPEC_SECRET, withExp), { h: 'campflow:12345', exp: 1767225599 });
  assert.equal(await C.readSfspRef(SPEC_SECRET, withExp + '.x'), null, 'extra part');
  assert.equal(await C.readSfspRef(SPEC_SECRET, await C.sfspRef(SPEC_SECRET, 'has space')), null, 'bad household ID');
});
test('spec v1 test vectors: message signature', async () => {
  const body = '{"type":"sfsp.form","camp":"camp-teumim","household":"campflow:12345","form":"Xy12AbCdEf34GhIjKl56","state":"received","at":"2026-11-12T18:00:00.000Z"}';
  const h = await C.signMessage(SPEC_SECRET, body, 1762970400);
  assert.equal(h['X-WG-Signature'], 'sha256=dfbdf1e2bfbc33a4122e6d98c917b51f9f22540bd5a9e4a400ab756516e1c411');
  assert.equal(await C.verifyMessage(SPEC_SECRET, body, '1762970400', h['X-WG-Signature'], { now: 1762970500 }), true);
  const r = await C.signRosterResponse(SPEC_SECRET, body, 1762970400);
  assert.equal(r['X-Roster-Signature'], h['X-WG-Signature'], 'roster answers are signed the same way');
});
