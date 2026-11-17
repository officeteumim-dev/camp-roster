// Family emails.
// POST {action:'daily'} with header x-cron-key   → welcome emails and scheduled reminders for every camp (runs once a day)
// POST {camp, action:'remind', family_ids, force?} → reminder now (director or office)
// POST {camp, action:'rejected', family_ids}      → "please send again" after the infirmary sends a form back
// POST {camp, action:'link', family_ids:[id]}      → a fresh family link to copy (director or office)
// POST {action:'daily_report'} with x-cron-key     → the 8 a.m. registration report
// POST {camp, action:'report_now'}                 → a report of everything since the last one, emailed now (who can see reports)
// POST {action:'application_submitted', id}        → "we received your application" to the parent (once)
// POST {action:'application_decided', id}          → accepted / waitlisted / declined email to the parent (office; once per decision)
// POST {action:'camp_request', id}                 → tells the site owner a new camp request came in (once per request)
// POST {action:'camp_request_answer', id}          → tells the requester it was approved or declined (site owner only, once)
import { admin, env, json, fail, cors, staffFor, sameText, must } from '../_shared/server.js';
import { newFamilyLink, sfspLink } from '../_shared/links.js';
import { dueEmail, buildEmail } from '../_shared/reminders.js';
import { reportDue, buildReportEmail, reportColumns, zoned } from '../_shared/reports.js';
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

    if (body.action === 'camp_request' || body.action === 'camp_request_answer') return json(await campRequestEmail(req, db, body));
    if (body.action === 'application_submitted' || body.action === 'application_decided') return json(await applicationEmail(req, db, body));

    const { data: camp } = await db.from('camps').select('*').eq('id', body.camp || '').maybeSingle();
    if (!camp) return fail('Unknown camp', 404);
    const me = await staffFor(req, db, camp.id);
    if (body.action === 'report_now') {
      // Anyone who can see reports may send one now (directors always).
      if (!me || !(me.roles.includes('director') || await me.can('reports', 'see'))) return fail('Not allowed', 403);
      return json(await reportNow(db, camp, me.email));
    }
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
  const { data: last } = await db.from('daily_reports').select('period_end').eq('camp_id', camp.id).order('period_end', { ascending: false }).limit(1).maybeSingle();
  const { data: lastAuto } = await db.from('daily_reports').select('report_date').eq('camp_id', camp.id).eq('manual', false).order('period_end', { ascending: false }).limit(1).maybeSingle();
  const due = reportDue(now, tz, last?.period_end || null, { lastDate: lastAuto?.report_date || null });
  if (!due.due) return { skipped: 'not due' };
  return makeReport(db, camp, { date: due.date, from: due.from, to: due.to, manual: false });
}

// "Run report now" (Reports tab): everything since the last report, emailed now.
async function reportNow(db, camp, by) {
  const tz = camp.timezone || 'America/New_York';
  const now = new Date();
  const { data: last } = await db.from('daily_reports').select('period_end').eq('camp_id', camp.id).order('period_end', { ascending: false }).limit(1).maybeSingle();
  const from = last?.period_end ? new Date(last.period_end).toISOString() : new Date(now.getTime() - 24 * 3600e3).toISOString();
  return makeReport(db, camp, { date: zoned(now, tz).date, from, to: now.toISOString(), manual: true, by });
}

async function makeReport(db, camp, { date, from, to, manual, by = null }) {
  const s = camp.settings || {}, tz = camp.timezone || 'America/New_York';
  const data = must(await db.rpc('registration_report', { p_camp: camp.id, p_from: from, p_to: to }), 'report');
  const ins = await db.from('daily_reports').insert({ camp_id: camp.id, report_date: date, period_start: from, period_end: to, data, manual, run_by: by }).select('id').single();
  if (ins.error) return { skipped: 'already made today' };   // another run got there first
  // Recipients: the list in Settings, or else the camp's directors.
  let to_ = Array.isArray(s.report_to) ? s.report_to.filter(e => /@/.test(e)) : [];
  if (!to_.length) to_ = (must(await db.from('staff').select('email').eq('camp_id', camp.id).eq('role', 'director'), 'directors') || []).map(r => r.email);
  if (!to_.length) return { id: ins.data.id, made: true, sent: 0 };
  const { data: items } = await db.from('perm_items').select('key, label').eq('camp_id', camp.id).eq('kind', 'field');
  const labels = Object.fromEntries((items || []).map(i => [i.key, i.label]));
  const email = buildReportEmail(camp, data, appUrl(), tz, reportColumns(s.report_columns, labels));
  let error = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_FROM') || `${camp.name} <office@wgcamps.com>`, to: to_, reply_to: s.reply_to || undefined, subject: email.subject, html: email.html, text: email.text })
    });
    if (!r.ok) error = (await r.json().catch(() => ({}))).message || `email service said ${r.status}`;
  } catch (e) { error = String(e.message || e); }
  await db.from('daily_reports').update({ sent_to: to_, error }).eq('id', ins.data.id);
  return { id: ins.data.id, made: true, campers: data.campers, sent: error ? 0 : to_.length, to: to_, error };
}

// ---------- Requests to open a camp ----------
const escH = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function mail(to, subject, text, replyTo) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('SITE_MAIL_FROM') || 'Camp Roster <office@wgcamps.com>', to, reply_to: replyTo || undefined, subject, text,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1b;max-width:600px;white-space:pre-line">${escH(text)}</div>` })
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `email service said ${r.status}`);
}
async function campRequestEmail(req, db, body) {
  if (!/^[0-9a-f-]{36}$/.test(body.id || '')) throw new Error('Bad request');
  const { data: r } = await db.from('camp_requests').select('*').eq('id', body.id).maybeSingle();
  if (!r) return { sent: false };
  const site = appUrl();
  if (body.action === 'camp_request') {
    // Anyone may poke this, but it only ever emails the owner once per real, pending request.
    if (r.status !== 'pending' || r.notified_at) return { sent: false };
    const { data: claimed } = await db.from('camp_requests').update({ notified_at: new Date().toISOString() }).eq('id', r.id).is('notified_at', null).select('id');
    if (!claimed || !claimed.length) return { sent: false };
    const owners = (must(await db.from('site_admins').select('email'), 'owners') || []).map(x => x.email);
    if (!owners.length) return { sent: false };
    await mail(owners, `Camp request: ${r.camp_name}`,
      `${r.name} (${r.email}) asked to open a camp in Camp Roster.\n\nCamp: ${r.camp_name}\n` + (r.location ? `Where: ${r.location}\n` : '') + (r.campers ? `About how many campers: ${r.campers}\n` : '') + (r.phone ? `Phone: ${r.phone}\n` : '') + (r.message ? `\n${r.message}\n` : '') +
      `\nApprove or decline it under Camp requests: ${site}/#requests`, r.email);
    return { sent: true };
  }
  // The decision: only a site owner, only once.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = token ? await db.auth.getUser(token) : { data: null };
  const email = u?.user?.email?.toLowerCase();
  const { data: owner } = email ? await db.from('site_admins').select('email').eq('email', email).maybeSingle() : { data: null };
  if (!owner) throw new Error('Not allowed');
  if (r.status === 'pending' || r.answer_sent_at) return { sent: false };
  const { data: claimed } = await db.from('camp_requests').update({ answer_sent_at: new Date().toISOString() }).eq('id', r.id).is('answer_sent_at', null).select('id');
  if (!claimed || !claimed.length) return { sent: false };
  const { data: camp } = r.camp_id ? await db.from('camps').select('name').eq('id', r.camp_id).maybeSingle() : { data: null };
  if (r.status === 'approved') await mail([r.email], `${camp?.name || r.camp_name} is ready in Camp Roster`,
    `Hi ${r.name},\n\nYour camp, ${camp?.name || r.camp_name}, is set up in Camp Roster and you're its director.\n\nSign in with this email address (${r.email}) at ${site}\n\nFrom Settings you can add your staff, your sessions and the forms you need.`, email);
  else await mail([r.email], `Your Camp Roster request`, `Hi ${r.name},\n\nThanks for your interest in Camp Roster. We're not able to open ${r.camp_name} right now. Reply to this email if you have any questions.`, email);
  return { sent: true };
}

// ---------- Online applications ----------
async function applicationEmail(req, db, body) {
  if (!/^[0-9a-f-]{36}$/.test(body.id || '')) throw new Error('Bad request');
  const { data: a } = await db.from('applications').select('*').eq('id', body.id).maybeSingle();
  if (!a) return { sent: false };
  const { data: camp } = await db.from('camps').select('*').eq('id', a.camp_id).single();
  const s = camp.settings || {}, d = a.data || {};
  const kids = (d.campers || []).map(k => k.first).filter(Boolean);
  const names = kids.length > 1 ? kids.slice(0, -1).join(', ') + ' and ' + kids[kids.length - 1] : kids[0] || 'your child';
  const from = env('MAIL_FROM') || `${camp.name} <office@wgcamps.com>`;
  const send = async (subject, text) => {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [a.email], reply_to: s.reply_to || undefined, subject, text,
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1b;max-width:600px;white-space:pre-line">${escH(text)}</div>` })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `email service said ${r.status}`);
  };
  const link = `${appUrl()}/register.html?camp=${encodeURIComponent(camp.slug)}`;
  if (body.action === 'application_submitted') {
    // Anyone may poke this; it emails only the applicant, only once, only for a sent application.
    if (a.status !== 'submitted' || a.confirmation_sent_at) return { sent: false };
    const { data: claimed } = await db.from('applications').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', a.id).is('confirmation_sent_at', null).select('id');
    if (!claimed || !claimed.length) return { sent: false };
    await send(`We received your application to ${camp.name}`,
      `Thank you! We received your application for ${names} to ${camp.name}.\n\nThe camp office will review it and email you. You can see what you sent at ${link}\n\nQuestions? Just reply to this email.`);
    return { sent: true };
  }
  // A decision: only the office, once per decision.
  const me = await staffFor(req, db, camp.id);
  if (!me || !(me.roles.includes('director') || await me.can('applications', 'change'))) throw new Error('Not allowed');
  if (!['accepted', 'waitlisted', 'declined'].includes(a.status) || a.emailed_status === a.status) return { sent: false };
  const { data: claimed } = await db.from('applications').update({ emailed_status: a.status }).eq('id', a.id).or(`emailed_status.is.null,emailed_status.neq.${a.status}`).select('id');
  if (!claimed || !claimed.length) return { sent: false };
  const text = {
    accepted: `Good news: ${names} ${kids.length > 1 ? 'have' : 'has'} been accepted to ${camp.name}!\n\nWe'll email you soon with the forms we need before camp.\n\nQuestions? Just reply to this email.`,
    waitlisted: `Thank you for applying to ${camp.name}. ${names} ${kids.length > 1 ? 'are' : 'is'} on our waiting list, and we'll email you if a place opens up.\n\nQuestions? Just reply to this email.`,
    declined: `Thank you for applying to ${camp.name}. We're sorry, but we're not able to offer ${names} a place this time.\n\nQuestions? Just reply to this email.`
  }[a.status];
  await send({ accepted: `Accepted to ${camp.name}`, waitlisted: `${camp.name}: waiting list`, declined: `Your application to ${camp.name}` }[a.status], text);
  return { sent: true };
}
