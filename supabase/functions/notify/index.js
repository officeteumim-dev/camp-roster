// Family emails.
// POST {action:'daily'} with header x-cron-key   → welcome emails and scheduled reminders for every camp (runs once a day)
// POST {camp, action:'remind', family_ids, force?} → reminder now (director or office)
// POST {camp, action:'rejected', family_ids}      → "please send again" after the infirmary sends a form back
// POST {camp, action:'link', family_ids:[id]}      → a fresh family link to copy (director or office)
import { admin, env, json, fail, cors, staffFor, sameText, must } from '../_shared/server.js';
import { newFamilyLink, sfspLink } from '../_shared/links.js';
import { dueEmail, buildEmail } from '../_shared/reminders.js';
import { reportDue, buildReportEmail, reportColumns } from '../_shared/reports.js';
import { appUrl } from '../_shared/links.js';

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

    if (body.action === 'daily_report') {
      const key = req.headers.get('x-cron-key');
      if (!env('CRON_KEY') || !key || !sameText(key, env('CRON_KEY'))) return fail('Not allowed', 403);
      const camps = must(await db.from('camps').select('*'), 'camps');
      const out = {};
      for (const camp of camps) out[camp.slug] = await dailyReport(db, camp, body.at ? new Date(body.at) : new Date());
      return json(out);
    }

    const { data: camp } = await db.from('camps').select('*').eq('id', body.camp || '').maybeSingle();
    if (!camp) return fail('Unknown camp', 404);
    const me = await staffFor(req, db, camp.id);
    // Reminders and family links: Forms checklist (change). "Please send again": Health forms (change).
    if (!me || !(await me.can(body.action === 'rejected' ? 'health_forms' : 'form_status', 'change'))) return fail('Not allowed', 403);
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

// The 8 a.m. registration report (every day but Saturday; Sunday covers since Friday).
async function dailyReport(db, camp, now) {
  const s = camp.settings || {};
  if (s.report_enabled === false) return { skipped: 'turned off' };
  const tz = camp.timezone || 'America/New_York';
  const { data: last } = await db.from('daily_reports').select('report_date, period_end').eq('camp_id', camp.id).order('period_end', { ascending: false }).limit(1).maybeSingle();
  const due = reportDue(now, tz, last?.period_end || null, { lastDate: last?.report_date || null });
  if (!due.due) return { skipped: 'not due' };
  const data = must(await db.rpc('registration_report', { p_camp: camp.id, p_from: due.from, p_to: due.to }), 'report');
  const ins = await db.from('daily_reports').insert({ camp_id: camp.id, report_date: due.date, period_start: due.from, period_end: due.to, data }).select('id').single();
  if (ins.error) return { skipped: 'already made today' };   // another run got there first
  // Recipients: the list in Settings, or else the camp's directors.
  let to = Array.isArray(s.report_to) ? s.report_to.filter(e => /@/.test(e)) : [];
  if (!to.length) to = (must(await db.from('staff').select('email').eq('camp_id', camp.id).eq('role', 'director'), 'directors') || []).map(r => r.email);
  if (!to.length) return { made: true, sent: 0 };
  const { data: items } = await db.from('perm_items').select('key, label').eq('camp_id', camp.id).eq('kind', 'field');
  const labels = Object.fromEntries((items || []).map(i => [i.key, i.label]));
  const email = buildReportEmail(camp, data, appUrl(), tz, reportColumns(s.report_columns, labels));
  let error = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_FROM') || `${camp.name} <office@wgcamps.com>`, to, reply_to: s.reply_to || undefined, subject: email.subject, html: email.html, text: email.text })
    });
    if (!r.ok) error = (await r.json().catch(() => ({}))).message || `email service said ${r.status}`;
  } catch (e) { error = String(e.message || e); }
  await db.from('daily_reports').update({ sent_to: to, error }).eq('id', ins.data.id);
  return { made: true, campers: data.campers, sent: error ? 0 : to.length, error };
}
