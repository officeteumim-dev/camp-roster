// Family emails.
// POST {action:'daily'} with header x-cron-key   → welcome emails and scheduled reminders for every camp (runs once a day)
// POST {camp, action:'remind', family_ids, force?} → reminder now (director or office)
// POST {camp, action:'rejected', family_ids}      → "please send again" after the infirmary sends a form back
// POST {camp, action:'link', family_ids:[id]}      → a fresh family link to copy (director or office)
import { admin, env, json, fail, cors, staffFor, sameText, must } from '../_shared/server.js';
import { newFamilyLink, sfspLink } from '../_shared/links.js';
import { dueEmail, buildEmail } from '../_shared/reminders.js';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('POST only', 405);
  const db = admin();
  let body; try { body = await req.json(); } catch { return fail('Bad request'); }

  try {
    if (body.action === 'daily') {
      const key = req.headers.get('x-cron-key');
      if (!env('CRON_KEY') || !key || !sameText(key, env('CRON_KEY'))) return fail('Not allowed', 403);
      const camps = must(await db.from('camps').select('*'), 'camps');
      const out = {};
      for (const camp of camps) out[camp.slug] = await daily(db, camp);
      return json(out);
    }

    const { data: camp } = await db.from('camps').select('*').eq('id', body.camp || '').maybeSingle();
    if (!camp) return fail('Unknown camp', 404);
    const me = await staffFor(req, db, camp.id);
    const allowed = body.action === 'rejected' ? ['director', 'infirmary'] : ['director', 'office'];
    if (!me || !me.roles.some(r => allowed.includes(r))) return fail('Not allowed', 403);
    const ids = Array.isArray(body.family_ids) ? body.family_ids.slice(0, 2000) : [];
    if (!ids.length) return fail('No families chosen');

    if (body.action === 'link') {
      const { data: fam } = await db.from('families').select('id').eq('id', ids[0]).eq('camp_id', camp.id).maybeSingle();
      if (!fam) return fail('Family not found', 404);
      return json({ link: await newFamilyLink(db, camp, fam.id) });
    }
    if (body.action === 'remind' || body.action === 'rejected') {
      const rows = must(await db.rpc('families_missing', { p_camp: camp.id }), 'families');
      const want = new Set(ids);
      let sent = 0, skipped = 0, failed = 0; const reasons = [];
      for (const f of rows.filter(r => want.has(r.family_id))) {
        const today = new Date().toISOString().slice(0, 10);
        if (!f.missing) { skipped++; reasons.push('nothing missing'); continue; }
        if (!body.force && body.action === 'remind' && f.paused_until && f.paused_until >= today) { skipped++; reasons.push('reminders paused'); continue; }
        const r = await send(db, camp, f, body.action === 'rejected' ? 'rejected' : 'manual', me.email);
        r === true ? sent++ : (failed++, reasons.push(r));
      }
      return json({ sent, skipped, failed, reasons });
    }
    return fail('Unknown action');
  } catch (e) {
    console.error(e);
    return fail(String(e.message || e), 500);
  }
});

async function daily(db, camp) {
  const s = camp.settings || {};
  if (!s.welcome_enabled && !s.reminders_enabled) return { skipped: 'emails are off' };
  const rows = must(await db.rpc('families_missing', { p_camp: camp.id }), 'families');
  const now = new Date();
  const counts = { welcome: 0, reminder: 0, failed: 0 };
  for (const f of rows) {
    const kind = dueEmail(f, s, now);
    if (!kind) continue;
    if (kind === 'welcome' && !f.missing) { await db.from('families').update({ welcome_sent_at: now.toISOString() }).eq('id', f.family_id); continue; }
    const r = await send(db, camp, f, kind, null);
    r === true ? counts[kind]++ : counts.failed++;
  }
  return counts;
}

// Sends one email to a family's parents. Returns true, or a short reason.
async function send(db, camp, row, kind, by) {
  const { data: fam } = await db.from('families').select('*').eq('id', row.family_id).single();
  const to = [...new Set([fam.father_email, fam.mother_email].filter(e => e && /@/.test(e)))];
  if (!to.length) return 'no email address on file';
  let reason = null;
  if (kind === 'rejected') {
    const { data: s } = await db.from('submissions').select('reject_reason').eq('family_id', fam.id).eq('status', 'rejected').order('reviewed_at', { ascending: false }).limit(1).maybeSingle();
    reason = s?.reject_reason || null;
  }
  const links = { portal: await newFamilyLink(db, camp, fam.id), sfsp: await sfspLink(db, camp, fam.external_id) };
  const email = buildEmail(kind === 'manual' ? 'reminder' : kind, { camp, family: fam, items: row.items, links, reason });
  const from = env('MAIL_FROM') || `${camp.name} <office@wgcamps.com>`;
  let providerId = null, error = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, reply_to: camp.settings?.reply_to || undefined, subject: email.subject, html: email.html, text: email.text })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) error = j.message || `email service said ${r.status}`; else providerId = j.id || null;
  } catch (e) { error = String(e.message || e); }
  await db.from('reminder_log').insert({ camp_id: camp.id, family_id: fam.id, kind, sent_to: to, missing: row.items, provider_id: providerId, error, sent_by: by });
  if (!error && kind === 'welcome') await db.from('families').update({ welcome_sent_at: new Date().toISOString() }).eq('id', fam.id);
  return error ? error : true;
}
