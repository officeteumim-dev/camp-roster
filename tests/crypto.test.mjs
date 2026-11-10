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
  assert.equal(await C.readSfspRef('s3cret', ref), 'campflow:12345');
  assert.equal(await C.readSfspRef('other', ref), null);
  assert.equal(await C.readSfspRef('s3cret', payload + '.x' + sig.slice(1)), null);
});

test('signed messages between the apps', async () => {
  const body = JSON.stringify({ type: 'sfsp.form', camp: 'abc', household: 'campflow:1', form: 'f1', state: 'received' });
  const h = await C.signMessage('k', body, 1_800_000_000);
  assert.equal(h['X-WG-Signature'], 'sha256=' + createHmac('sha256', 'k').update(`1800000000.${body}`).digest('hex'));
  assert.equal(await C.verifyMessage('k', body, h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_100 }), true);
  assert.equal(await C.verifyMessage('k', body + ' ', h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_100 }), false, 'tampered body');
  assert.equal(await C.verifyMessage('k', body, h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_001_000 }), false, 'too old');
  assert.equal(await C.verifyMessage('', body, h['X-WG-Timestamp'], h['X-WG-Signature'], { now: 1_800_000_100 }), false, 'no secret');
});
