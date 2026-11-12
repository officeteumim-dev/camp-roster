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

// The SFSP app's household reference (spec v1, section 4):
// base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, that first part)). Payload {"v":1,"h":...,"exp"?}.
export const ID_RE = /^[A-Za-z0-9:_-]{1,100}$/;
export async function sfspRef(secret, household, exp) {
  const p = { v: 1, h: household };
  if (exp) p.exp = Math.floor(exp);
  const payload = b64url(enc.encode(JSON.stringify(p)));
  return `${payload}.${await hmacB64url(secret, payload)}`;
}
// Returns {h, exp} or null. Does not check exp: the pre-fill endpoint does.
export async function readSfspRef(secret, ref) {
  const [payload, sig, extra] = String(ref || '').split('.');
  if (!secret || !payload || !sig || extra !== undefined || !sameText(sig, await hmacB64url(secret, payload))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return p && p.v === 1 && ID_RE.test(p.h) ? { h: p.h, exp: Number.isFinite(p.exp) ? p.exp : null } : null;
  } catch { return null; }
}

// Messages between the two apps: X-WG-Timestamp + X-WG-Signature: sha256=<hex HMAC of "<timestamp>.<raw body>">.
export async function signMessage(secret, body, ts = Math.floor(Date.now() / 1000)) {
  return { 'X-WG-Timestamp': String(ts), 'X-WG-Signature': 'sha256=' + await hmacHex(secret, `${ts}.${body}`) };
}
export async function verifyMessage(secret, body, tsHeader, sigHeader, { maxSkew = 300, now = Date.now() / 1000 } = {}) {
  const ts = Number(tsHeader);
  if (!secret || !Number.isFinite(ts) || Math.abs(now - ts) > maxSkew) return false;
  const want = 'sha256=' + await hmacHex(secret, `${ts}.${body}`);
  return sameText(want, String(sigHeader || ''));
}

// The roster app's signed answer to sfsp.roster.request (spec v1, section 7).
export async function signRosterResponse(secret, body, ts = Math.floor(Date.now() / 1000)) {
  return { 'X-Roster-Timestamp': String(ts), 'X-Roster-Signature': 'sha256=' + await hmacHex(secret, `${ts}.${body}`) };
}
