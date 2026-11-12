// Connection with SFSP by W Group (connection spec v1).
// Roster app address:  POST https://<project>.supabase.co/functions/v1/sfsp
//   signed messages: sfsp.form, sfsp.snapshot, sfsp.test, sfsp.roster.request (answered with a signed roster)
// Pre-fill address:    GET  https://<project>.supabase.co/functions/v1/sfsp/prefill?camp=<SFSP camp ID>&r=<REF>
//   called from the parent's phone; one household, or 404
// Household list:      GET  .../sfsp/households?camp=<SFSP camp ID>   signed, for the SFSP app's matching
// Never log REFs, secrets or request bodies.
import { admin, json, fail, cors, must } from '../_shared/server.js';
import { verifyMessage, readSfspRef, signRosterResponse, ID_RE } from '../_shared/crypto.js';

// wgcamps.com and www.wgcamps.com both serve the SFSP site (www redirects to the bare domain).
const PREFILL_ORIGINS = ['https://wgcamps.com', 'https://www.wgcamps.com', 'https://staging.wgcamps.com', 'https://staging--sfsp-wgroup.netlify.app'];

async function connection(db, sfspCampId) {
  if (!ID_RE.test(sfspCampId || '')) return null;
  const { data } = await db.rpc('sfsp_secret_for', { p_camp: null, p_sfsp_camp_id: sfspCampId });
  const row = Array.isArray(data) ? data[0] : data;
  return row?.secret ? row : null;
}

function prefillHeaders(req) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': PREFILL_ORIGINS.includes(origin) ? origin : PREFILL_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600', Vary: 'Origin', 'Cache-Control': 'no-store',
  };
}

async function prefill(req, db, url) {
  const h = prefillHeaders(req);
  const notFound = () => new Response(null, { status: 404, headers: h });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const { data: ok } = await db.rpc('rate_ok', { p_key: 'prefill:' + ip, p_limit: 30, p_seconds: 60 });
  if (ok === false) return new Response(null, { status: 429, headers: { ...h, 'Retry-After': '60' } });
  const conn = await connection(db, url.searchParams.get('camp'));
  if (!conn) return notFound();
  const ref = await readSfspRef(conn.secret, url.searchParams.get('r'));
  if (!ref || (ref.exp && ref.exp < Date.now() / 1000)) return notFound();
  const { data } = await db.rpc('sfsp_prefill', { p_camp: conn.camp_id, p_household: ref.h });
  if (!data) return notFound();
  return new Response(JSON.stringify(data), { status: 200, headers: { ...h, 'Content-Type': 'application/json' } });
}

Deno.serve(async req => {
  const db = admin();
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path.endsWith('/prefill')) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: prefillHeaders(req) });
    if (req.method !== 'GET') return new Response(null, { status: 405, headers: prefillHeaders(req) });
    try { return await prefill(req, db, url); } catch (e) { console.error('prefill failed:', e.message); return new Response(null, { status: 404, headers: prefillHeaders(req) }); }
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const ts = req.headers.get('x-wg-timestamp'), sig = req.headers.get('x-wg-signature');

  if (req.method === 'GET' && path.endsWith('/households')) {
    const conn = await connection(db, url.searchParams.get('camp'));
    if (!conn || !(await verifyMessage(conn.secret, '', ts, sig))) return fail('Not allowed', 403);
    return json({ households: must(await db.rpc('sfsp_households', { p_camp: conn.camp_id }), 'households') });
  }
  if (req.method !== 'POST') return fail('Not found', 404);

  const raw = await req.text();
  let msg;
  try { msg = JSON.parse(raw); } catch { return fail('Bad request'); }
  const conn = await connection(db, msg?.camp);
  if (!conn || !(await verifyMessage(conn.secret, raw, ts, sig))) return fail('Not allowed', 403);
  const campId = conn.camp_id;

  try {
    if (msg.type === 'sfsp.test') return json({ ok: true });

    if (msg.type === 'sfsp.form') {
      if (!ID_RE.test(msg.household || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(msg.form || '') || !['received', 'removed'].includes(msg.state)) return fail('Bad message');
      // Idempotent: one row per form; "removed" only clears this form, so another received form keeps the household handed in.
      must(await db.from('sfsp_forms').upsert({ camp_id: campId, form_id: msg.form, household: msg.household, state: msg.state, at: new Date().toISOString() }, { onConflict: 'camp_id,form_id' }), 'save');
      return json({ ok: true });
    }

    if (msg.type === 'sfsp.snapshot') {
      const list = Array.isArray(msg.households) ? msg.households.filter(h => ID_RE.test(h)) : null;
      if (!list) return fail('Bad message');
      const want = new Set(list);
      const rows = must(await db.from('sfsp_forms').select('form_id, household, state').eq('camp_id', campId), 'load');
      const now = new Date().toISOString();
      const has = new Set(rows.filter(r => r.state === 'received').map(r => r.household));
      const stale = rows.filter(r => r.state === 'received' && !want.has(r.household)).map(r => r.form_id);
      if (stale.length) must(await db.from('sfsp_forms').update({ state: 'removed', at: now }).eq('camp_id', campId).in('form_id', stale), 'fix');
      const missing = list.filter(h => !has.has(h)).map(h => ({ camp_id: campId, form_id: `snapshot-${h.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64), household: h, state: 'received', at: now }));
      if (missing.length) must(await db.from('sfsp_forms').upsert(missing, { onConflict: 'camp_id,form_id' }), 'fix');
      return json({ ok: true, added: missing.length, removed: stale.length });
    }

    if (msg.type === 'sfsp.roster.request') {
      const roster = must(await db.rpc('sfsp_roster', { p_camp: campId }), 'roster');
      const body = JSON.stringify(roster);
      if (body.length > 900 * 1024) console.error('sfsp roster is over the 900 KB limit in the spec:', body.length, 'bytes');
      return new Response(body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(await signRosterResponse(conn.secret, body)) } });
    }
    return fail('Unknown message type');
  } catch (e) {
    console.error('sfsp message failed:', msg.type, e.message);
    return fail('Could not handle the message', 500);
  }
});
