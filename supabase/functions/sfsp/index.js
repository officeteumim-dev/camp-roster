// Connection with the SFSP app (see the SFSP integration brief).
// POST /sfsp            signed messages from the SFSP app: sfsp.form, sfsp.snapshot, sfsp.test
// GET  /sfsp/households signed request from the SFSP app for its automatic family matching (?camp=<SFSP camp id>)
import { admin, json, fail, cors, must } from '../_shared/server.js';
import { verifyMessage } from '../_shared/crypto.js';

async function connection(db, sfspCampId) {
  if (!sfspCampId) return null;
  const { data } = await db.from('camp_secrets').select('camp_id, sfsp_secret').eq('sfsp_camp_id', String(sfspCampId)).maybeSingle();
  return data?.sfsp_secret ? data : null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = admin();
  const url = new URL(req.url);
  const ts = req.headers.get('x-wg-timestamp'), sig = req.headers.get('x-wg-signature');

  if (req.method === 'GET' && url.pathname.endsWith('/households')) {
    const conn = await connection(db, url.searchParams.get('camp'));
    if (!conn || !(await verifyMessage(conn.sfsp_secret, '', ts, sig))) return fail('Not allowed', 403);
    return json({ households: must(await db.rpc('sfsp_households', { p_camp: conn.camp_id }), 'households') });
  }
  if (req.method !== 'POST') return fail('Not found', 404);

  const raw = await req.text();
  let msg;
  try { msg = JSON.parse(raw); } catch { return fail('Bad request'); }
  const conn = await connection(db, msg.camp);
  if (!conn || !(await verifyMessage(conn.sfsp_secret, raw, ts, sig))) return fail('Not allowed', 403);
  const campId = conn.camp_id;
  const household = s => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(s);

  if (msg.type === 'sfsp.test') return json({ ok: true });

  if (msg.type === 'sfsp.form') {
    if (!household(msg.household) || !/^[A-Za-z0-9_-]{1,64}$/.test(msg.form || '') || !['received', 'removed'].includes(msg.state)) return fail('Bad message');
    must(await db.from('sfsp_forms').upsert({ camp_id: campId, form_id: msg.form, household: msg.household, state: msg.state, at: new Date().toISOString() }, { onConflict: 'camp_id,form_id' }), 'save');
    return json({ ok: true });
  }

  if (msg.type === 'sfsp.snapshot') {
    const list = Array.isArray(msg.households) ? msg.households.filter(household) : null;
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
  return fail('Unknown message type');
});
