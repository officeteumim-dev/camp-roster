// Tokens and signatures (Web Crypto: works in Deno, Node 18+ and browsers).
const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s) {
  const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  return Uint8Array.from(t, c => c.charCodeAt(0));
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// A family's link token (shown once in the email) and the hash we keep.
export function newToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export async function sha256Hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function hmacRaw(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
export const hmacHex = async (secret, msg) => hex(await hmacRaw(secret, msg));
export const hmacB64url = async (secret, msg) => b64url(await hmacRaw(secret, msg));

function sameText(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// The SFSP app's household reference: base64url(JSON) + "." + base64url(HMAC-SHA256(secret, that first part)).
export async function sfspRef(secret, household) {
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, h: household })));
  return `${payload}.${await hmacB64url(secret, payload)}`;
}
export async function readSfspRef(secret, ref) {
  const [payload, sig] = String(ref || '').split('.');
  if (!payload || !sig || !sameText(sig, await hmacB64url(secret, payload))) return null;
  try { return JSON.parse(new TextDecoder().decode(fromB64url(payload))).h || null; } catch { return null; }
}

// Messages between the two apps: X-WG-Timestamp + X-WG-Signature: sha256=<hex HMAC of "<timestamp>.<raw body>">.
export async function signMessage(secret, body, ts = Math.floor(Date.now() / 1000)) {
  return { 'X-WG-Timestamp': String(ts), 'X-WG-Signature': 'sha256=' + await hmacHex(secret, `${ts}.${body}`) };
}
export async function verifyMessage(secret, body, tsHeader, sigHeader, { maxSkew = 600, now = Date.now() / 1000 } = {}) {
  const ts = Number(tsHeader);
  if (!secret || !Number.isFinite(ts) || Math.abs(now - ts) > maxSkew) return false;
  const want = 'sha256=' + await hmacHex(secret, `${ts}.${body}`);
  return sameText(want, String(sigHeader || ''));
}
