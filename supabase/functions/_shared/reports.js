// The daily registration report: when it's due, and turning a local time into an exact moment.

// Parts of a moment as seen in a time zone.
export function zoned(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}` };
}

// "2026-11-05T14:30:00" as wall-clock time in tz -> ISO string with the right offset ("2026-11-05T19:30:00.000Z").
export function localToIso(local, tz) {
  if (!local) return null;
  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  let guess = want;
  for (let i = 0; i < 3; i++) {   // converge on the offset (handles daylight saving)
    const z = zoned(new Date(guess), tz);
    const seen = Date.UTC(z.y, z.m - 1, z.d, z.h, z.min, z.s);
    guess += want - seen;
  }
  return new Date(guess).toISOString();
}

// Is a report due now? Reports go out at `hour` local time, every day except Saturday.
// Each report covers from the end of the previous report (so Sunday covers Friday 8 a.m. to Sunday 8 a.m.).
// lastEnd: ISO time the previous report ended, or null. Returns { due, date, from, to } or { due: false }.
export function reportDue(now, tz, lastEnd, { hour = 8, lastDate = null } = {}) {
  const z = zoned(now, tz);
  if (z.weekday === 'Sat' || z.h !== hour) return { due: false };
  if (lastDate === z.date) return { due: false };                   // already sent today
  const to = localToIso(`${z.date}T${String(hour).padStart(2, '0')}:00:00`, tz);
  const back = z.weekday === 'Sun' ? 48 : 24;
  const from = lastEnd && new Date(lastEnd) < new Date(to) ? new Date(lastEnd).toISOString() : new Date(new Date(to).getTime() - back * 3600e3).toISOString();
  return { due: true, date: z.date, from, to };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso, tz) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ageOn = (dob, on) => { if (!dob) return ''; const b = new Date(dob + 'T12:00:00Z'), d = new Date(on); let a = d.getUTCFullYear() - b.getUTCFullYear(); if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--; return String(a); };

// Columns a director can choose for the report (web/app.js has the same list for Settings and the Reports tab).
// The camper's name is always the first column.
export const REPORT_COLUMNS = [
  ['grade', 'Grade', (c) => c.grade],
  ['sessions', 'Sessions', (c) => (c.sessions || []).join(' & ')],
  ['parents', 'Parents', (c, f) => f.parents],
  ['city', 'City', (c, f) => [f.city, f.state].filter(Boolean).join(', ')],
  ['applied', 'Applied', (c, f, tz) => f.applied_at ? new Date(f.applied_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' }) : ''],
  ['newfamily', 'New family', (c, f) => f.new_family ? 'New' : 'Sibling added'],
  ['age', 'Age', (c, f, tz, data) => ageOn(c.dob, data.to)],
  ['dob', 'Date of birth', (c) => c.dob || ''],
  ['gender', 'Gender', (c) => c.gender],
  ['phone', 'Phone', (c, f) => f.phone],
  ['email', 'Email', (c, f) => f.email],
  ['hebrew', 'Hebrew name', (c) => c.hebrew_name],
  ['staffchild', 'Staff child', (c) => c.staff_child ? 'Yes' : ''],
  ['campflow', 'Camp Flow family #', (c, f) => f.campflow_id]
];
export const REPORT_DEFAULT = ['grade', 'sessions', 'parents', 'city', 'applied', 'newfamily'];

// The columns to use: the director's choice (keys; "f_..." are the camp's own camper details), in that order.
export function reportColumns(chosen, customLabels = {}) {
  const keys = Array.isArray(chosen) && chosen.length ? chosen : REPORT_DEFAULT;
  return keys.map(k => {
    const b = REPORT_COLUMNS.find(x => x[0] === k);
    if (b) return { key: k, label: b[1], get: b[2] };
    if (/^f_/.test(k) && customLabels[k]) return { key: k, label: customLabels[k], get: c => (c.fields || {})[k] };
    return null;
  }).filter(Boolean);
}

// The report email. data: registration_report() output; columns: reportColumns(...).
export function buildReportEmail(camp, data, appUrl, tz = 'America/New_York', columns = reportColumns(null)) {
  const n = +data.campers, period = `${when(data.from, tz)} to ${when(data.to, tz)}`;
  const subject = `${camp.name}: ${n ? `${n} new camper${n === 1 ? '' : 's'}` : 'no new registrations'} (${new Date(data.to).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })})`;
  const head = n ? `${n} new camper${n === 1 ? '' : 's'} from ${data.families} famil${+data.families === 1 ? 'y' : 'ies'} (${data.new_families} new to camp).` : 'No new registrations.';
  const rows = [];
  for (const f of data.list) for (const c of f.campers) rows.push([c.name].concat(columns.map(col => String(col.get(c, f, tz, data) ?? ''))));
  const text = `Daily registration report\n${period}\n\n${head}\n\n` + rows.map(r => '- ' + r.filter(Boolean).join(', ')).join('\n') + `\n\nAll reports: ${appUrl}/#reports\n`;
  const th = 'text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid #c9c6bd;font-size:13px;color:#66645e;font-weight:600';
  const td = 'padding:6px 10px 6px 0;border-bottom:1px solid #e4e2dc;vertical-align:top';
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1b;max-width:900px">
<p style="margin:0;color:#66645e">${esc(camp.name)} · daily registration report</p><h2 style="margin:4px 0 2px">${esc(head)}</h2><p style="margin:0 0 14px;color:#66645e">${esc(period)}</p>
${rows.length ? `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Camper</th>${columns.map(c => `<th style="${th}">${esc(c.label)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((v, i) => `<td style="${td}">${i === 0 ? `<strong>${esc(v)}</strong>` : esc(v)}</td>`).join('')}</tr>`).join('')}</table>` : ''}
<p style="margin-top:18px"><a href="${esc(appUrl)}/#reports" style="color:#1f5fae">All reports in the roster app</a></p></div>`;
  return { subject, text, html };
}
