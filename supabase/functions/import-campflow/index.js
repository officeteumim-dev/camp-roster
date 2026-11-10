// Imports a Camp Flow report (families, campers or transactions).
// Called by the Gmail script with the report's download link (header x-import-key), or by office staff uploading a
// file from the app (signed in as director or office). ?camp=<camp slug or id>
import { readXlsx } from '../_shared/xlsx.js';
import * as CF from '../_shared/campflow.js';
import { admin, env, json, fail, cors, staffFor, campBySlugOrId, sameText, chunked, must } from '../_shared/server.js';

const REPORT_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(digitaloceanspaces\.com|campflow\.org)\//i;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('POST only', 405);
  const db = admin();
  const url = new URL(req.url);
  const camp = await campBySlugOrId(db, url.searchParams.get('camp'));
  if (!camp) return fail('Unknown camp', 404);

  // Who is importing?
  let via;
  const key = req.headers.get('x-import-key');
  if (key) {
    if (!env('IMPORT_KEY') || !sameText(key, env('IMPORT_KEY'))) return fail('Not allowed', 403);
    via = 'email';
  } else {
    const me = await staffFor(req, db, camp.id);
    if (!me || !me.roles.some(r => r === 'director' || r === 'office')) return fail('Not allowed', 403);
    via = me.email;
  }

  // The file: either the bytes, or a Camp Flow download link to fetch.
  let bytes, fileName = url.searchParams.get('name') || 'report.xlsx';
  try {
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      const body = await req.json();
      if (!REPORT_HOSTS.test(body.url || '')) return fail('That is not a Camp Flow report link');
      const r = await fetch(body.url);
      if (!r.ok) return fail(`Could not download the report (${r.status}). The link may have expired.`, 502);
      bytes = new Uint8Array(await r.arrayBuffer());
      fileName = decodeURIComponent(new URL(body.url).pathname.split('/').pop() || fileName);
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }
    if (bytes.length > 20 * 1024 * 1024) return fail('The file is too large');
    const { rows } = await readXlsx(bytes);
    if (rows.length < 1) return fail('The report is empty');
    const report = CF.detectReport(rows[0]);
    if (!report) return fail('This doesn\'t look like a Camp Flow families, campers or transactions report');
    const result = report === 'families' ? await importFamilies(db, camp, rows)
      : report === 'campers' ? await importCampers(db, camp, rows)
      : await importTransactions(db, camp, rows);
    must(await db.from('import_runs').insert({ camp_id: camp.id, report, file_name: fileName, via, counts: result.counts, problems: result.problems.slice(0, 200) }), 'log');
    return json({ report, ...result });
  } catch (e) {
    console.error(e);
    await db.from('import_runs').insert({ camp_id: camp.id, report: 'unknown', file_name: fileName, via, counts: {}, problems: [{ problem: String(e.message || e) }] });
    return fail(String(e.message || e), 500);
  }
});

async function loadAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function importFamilies(db, camp, rows) {
  const { families, problems } = CF.parseFamilies(rows);
  const existing = await loadAll(() => db.from('families').select('id, external_id, active').eq('camp_id', camp.id));
  const plan = CF.planFamilies(families, { families: existing });
  const now = new Date().toISOString();

  await chunked(plan.insert, 200, async part => {
    must(await db.from('families').insert(part.map(p => ({ camp_id: camp.id, external_id: p.external_id, ...p.family }))), 'add families');
  });
  for (const p of plan.update) must(await db.from('families').update({ ...p.family, active: true, missing_since: null, updated_at: now }).eq('id', p.id), 'update family');
  if (plan.deactivate.length) must(await db.from('families').update({ active: false, missing_since: now }).in('id', plan.deactivate), 'flag families');

  const all = await loadAll(() => db.from('families').select('id, external_id').eq('camp_id', camp.id));
  const idByExt = new Map(all.map(f => [f.external_id, f.id]));

  // Money: read-only copy of Camp Flow's figures.
  const accounts = families.map(p => ({ family_id: idByExt.get(p.external_id), camp_id: camp.id, ...p.finance, source: 'campflow', as_of: now })).filter(a => a.family_id);
  await chunked(accounts, 200, async part => { must(await db.from('finance_accounts').upsert(part, { onConflict: 'family_id' }), 'money'); });

  // Campers named in the report, until the camper report is in use.
  const campers = await loadAll(() => db.from('campers').select('id, family_id, external_id, first_name, derived, active').eq('camp_id', camp.id));
  const d = CF.planDerivedCampers(families, idByExt, campers);
  await chunked(d.insert, 200, async part => { must(await db.from('campers').insert(part.map(c => ({ camp_id: camp.id, ...c }))), 'add campers'); });
  if (d.deactivate.length) must(await db.from('campers').update({ active: false, missing_since: now }).in('id', d.deactivate), 'flag campers');

  if (plan.skippedDeactivation) problems.push({ problem: 'This report has far fewer families than the app. Nobody was marked as gone; check that the report is not filtered.' });
  return { counts: { families: families.length, added: plan.insert.length, updated: plan.update.length, flagged: plan.deactivate.length, campers_added: d.insert.length, campers_flagged: d.deactivate.length }, problems };
}

async function importCampers(db, camp, rows) {
  const { campers: parsed, problems } = CF.parseCampers(rows);
  const fams = await loadAll(() => db.from('families').select('id, external_id').eq('camp_id', camp.id));
  const idByExt = new Map(fams.map(f => [f.external_id, f.id]));
  const existing = await loadAll(() => db.from('campers').select('id, family_id, external_id, first_name, derived, active').eq('camp_id', camp.id));
  const plan = CF.planCampers(parsed, idByExt, existing);
  problems.push(...plan.problems);
  const now = new Date().toISOString();

  // Sessions are matched by name (or the name Camp Flow uses); new names become new sessions.
  const sessions = must(await db.from('sessions').select('id, name, external_name').eq('camp_id', camp.id), 'sessions');
  const sessionId = async name => {
    const n = CF.norm(name);
    let s = sessions.find(x => CF.norm(x.external_name || '') === n || CF.norm(x.name) === n);
    if (!s) { s = must(await db.from('sessions').insert({ camp_id: camp.id, name, external_name: name }).select().single(), 'add session'); sessions.push(s); }
    return s.id;
  };

  const touched = [];
  for (const c of plan.insert) {
    const { sessions: ss, bunk, ...rec } = c;
    const row = must(await db.from('campers').insert({ camp_id: camp.id, ...rec }).select('id').single(), 'add camper');
    touched.push([row.id, ss]);
  }
  for (const c of plan.update) {
    const { id, sessions: ss, bunk, ...rec } = c;
    must(await db.from('campers').update({ ...rec, active: true, missing_since: null, updated_at: now }).eq('id', id), 'update camper');
    touched.push([id, ss]);
  }
  for (const [id, ss] of touched) {
    if (!ss.length) continue;
    const ids = [];
    for (const name of ss) ids.push(await sessionId(name));
    must(await db.from('enrollments').delete().eq('camper_id', id).not('session_id', 'in', `(${ids.join(',')})`), 'enrollments');
    must(await db.from('enrollments').upsert(ids.map(sid => ({ camper_id: id, session_id: sid, camp_id: camp.id })), { onConflict: 'camper_id,session_id', ignoreDuplicates: true }), 'enrollments');
  }

  // Campers from an earlier camper report who are no longer in it are flagged (unless this report is much smaller).
  const keep = new Set(touched.map(t => t[0]));
  const fromReport = existing.filter(c => !c.derived && c.active);
  const gone = fromReport.filter(c => !keep.has(c.id)).map(c => c.id);
  const safe = fromReport.length === 0 || parsed.length >= Math.ceil(fromReport.length * 0.6);
  if (gone.length && safe) must(await db.from('campers').update({ active: false, missing_since: now }).in('id', gone), 'flag campers');
  if (gone.length && !safe) problems.push({ problem: 'This report has far fewer campers than the app. Nobody was marked as gone; check that the report is not filtered.' });
  return { counts: { campers: parsed.length, added: plan.insert.length, updated: plan.update.length, flagged: safe ? gone.length : 0 }, problems };
}

async function importTransactions(db, camp, rows) {
  const { entries, problems } = CF.parseTransactions(rows);
  const fams = await loadAll(() => db.from('families').select('id, external_id').eq('camp_id', camp.id));
  const idByExt = new Map(fams.map(f => [f.external_id, f.id]));
  const seen = new Map();
  const out = [];
  for (const e of entries) {
    const fid = idByExt.get(e.family_external_id);
    if (!fid) { problems.push({ problem: `Family ${e.family_external_id} not found` }); continue; }
    // Rows without a transaction ID get a stable one from their contents, so re-imports don't double them.
    let ext = e.external_id;
    if (!ext) { const base = `h:${e.family_external_id}|${e.occurred_on}|${e.kind}|${e.amount_cents}|${e.description || ''}`; const n = (seen.get(base) || 0) + 1; seen.set(base, n); ext = `${base}|${n}`; }
    out.push({ camp_id: camp.id, family_id: fid, external_id: ext, occurred_on: e.occurred_on, kind: e.kind, description: e.description, amount_cents: e.amount_cents, source: 'campflow' });
  }
  await chunked(out, 300, async part => { must(await db.from('finance_entries').upsert(part, { onConflict: 'camp_id,source,external_id', ignoreDuplicates: true }), 'money entries'); });
  return { counts: { entries: out.length }, problems };
}
