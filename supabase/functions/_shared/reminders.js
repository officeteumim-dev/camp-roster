// When to remind a family, and what the email says. Pure functions, tested on their own.

const DAY = 864e5;
const ymd = d => new Date(d).toISOString().slice(0, 10);

// Days between reminders for a given day, counting toward the forms deadline:
//   until March 31: every 28 days · April: every 14 · May until a week before: every 7 · last week: every 2 · after: every 7
export function intervalDays(today, deadline) {
  const t = new Date(ymd(today) + 'T12:00:00Z');
  if (!deadline) return 14;
  const d = new Date(deadline + 'T12:00:00Z');
  const left = Math.round((d - t) / DAY);
  if (left < 0) return 7;
  if (left <= 7) return 2;
  const m = t.getUTCMonth() + 1;
  if (m === 4) return 14;
  if (m === 5 || m === 6) return 7;
  if (m >= 1 && m <= 3) return 28;
  return 28; // autumn, from registration
}

// family: {missing, welcome_sent_at, paused_until, last_reminder}; settings: camp settings.
// Returns 'welcome' | 'reminder' | null.
export function dueEmail(family, settings, now = new Date()) {
  const today = ymd(now);
  if (family.paused_until && family.paused_until >= today) return null;
  if (!family.welcome_sent_at) return settings.welcome_enabled ? 'welcome' : null;
  if (!settings.reminders_enabled || !family.missing) return null;
  const last = family.last_reminder ? new Date(family.last_reminder) : new Date(family.welcome_sent_at);
  const gap = intervalDays(now, settings.deadline);
  // A day's grace so a job that runs at 9:05 one day and 9:00 the next doesn't skip a whole day.
  return now - last >= (gap - 0.5) * DAY ? 'reminder' : null;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

// items: [{camper, label, key, status}] still missing. links: {portal, sfsp}.
export function buildEmail(kind, { camp, family, items, links, reason }) {
  const name = [family.father_first, family.mother_first].filter(Boolean).join(' and ') || `${family.last_name} family`;
  const deadline = camp.settings?.deadline ? longDate(camp.settings.deadline) : null;
  const sfspMissing = items.some(i => i.key === 'sfsp');
  const other = items.filter(i => i.key !== 'sfsp');
  const byChild = new Map();
  for (const i of other) { const k = i.camper || 'The whole family'; if (!byChild.has(k)) byChild.set(k, []); byChild.get(k).push(i.label + (i.status === 'rejected' ? ' (please send again)' : '')); }

  const subject = kind === 'welcome' ? `${camp.name}: forms for this summer`
    : kind === 'rejected' ? `${camp.name}: please send a form again`
    : `${camp.name}: ${items.length} form${items.length === 1 ? '' : 's'} still needed${deadline ? ` by ${deadline}` : ''}`;
  const intro = kind === 'welcome'
    ? `Thank you for registering with ${camp.name}. Before the summer we need a few forms for each camper. Everything can be done from your phone, a little at a time.`
    : kind === 'rejected'
    ? `The camp nurse looked at a form you sent and needs it again${reason ? `: ${reason}` : '.'}`
    : `This is a reminder that we still need the following${deadline ? `, by ${deadline}` : ''}.`;

  const listText = [...byChild].map(([k, v]) => `${k}:\n${v.map(x => `  - ${x}`).join('\n')}`).join('\n') + (sfspMissing ? `\nSFSP meal form (once per family)` : '');
  const text = `Dear ${name},\n\n${intro}\n\n${listText}\n\nYour family's forms page:\n${links.portal}\n` +
    (sfspMissing && links.sfsp ? `\nSFSP meal form:\n${links.sfsp}\n` : '') +
    `\nThese links are private to your family; please don't forward them.\n\n${camp.name}` + (camp.settings?.phone ? `\n${camp.settings.phone}` : '');

  const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#1f5fae;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(label)}</a>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1d1d1b;max-width:560px">
<p>Dear ${esc(name)},</p><p>${esc(intro)}</p>
${[...byChild].map(([k, v]) => `<p style="margin:12px 0 4px"><strong>${esc(k)}</strong></p><ul style="margin:0;padding-left:20px">${v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
<p style="margin:20px 0">${btn(links.portal, 'Open your forms')}</p>
${sfspMissing ? `<p style="margin:20px 0 8px"><strong>SFSP meal form</strong> (once per family, about 5 minutes)</p><p>${links.sfsp ? btn(links.sfsp, 'Fill in the SFSP form') : 'You can open it from your forms page.'}</p>` : ''}
<p style="color:#66645e;font-size:14px">These links are private to your family; please don't forward them.</p>
<p>${esc(camp.name)}${camp.settings?.phone ? `<br>${esc(camp.settings.phone)}` : ''}</p></div>`;
  return { subject, text, html };
}
