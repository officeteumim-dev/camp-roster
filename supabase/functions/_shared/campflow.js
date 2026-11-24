// Reading Camp Flow reports (families, campers, transactions) into the app's records, and working out what an import
// changes. Pure functions: used by the import server function and by the tests.

export const norm = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const orNull = s => (clean(s) || null);

// Columns are found by name, allowing for the usual variations.
function finder(headers) {
  const keys = headers.map(norm);
  return (...names) => {
    for (const n of names) { const i = keys.indexOf(norm(n)); if (i >= 0) return i; }
    return -1;
  };
}

export function familyIdFromLink(v) {
  const m = String(v ?? '').match(/families\/(\d+)/i) || String(v ?? '').match(/^\s*(\d+)\s*$/);
  return m ? m[1] : null;
}
export function camperIdFromLink(v) {
  const m = String(v ?? '').match(/campers\/(\d+)/i) || String(v ?? '').match(/^\s*(\d+)\s*$/);
  return m ? m[1] : null;
}

// "$1,250.00", "-$40", "(40.00)", "1250" -> cents. Blank -> null.
export function moneyCents(v) {
  let s = clean(v);
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-\$/.test(s);
  s = s.replace(/[^0-9.]/g, '');
  if (!s) return null;
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// Dates: "11/05/2026", "11/05/2026 2:30 pm", "2026-11-05", or an Excel serial number. Returns ISO date or datetime.
export function parseDate(v, withTime = false) {
  const s = clean(v);
  if (!s) return null;
  let y, mo, d, h = 0, mi = 0;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?)?/i))) {
    [mo, d, y] = [+m[1], +m[2], +m[3] < 100 ? 2000 + +m[3] : +m[3]];
    if (m[4]) { h = +m[4] % 12 + (/^p/i.test(m[6] || '') ? 12 : 0); if (!m[6]) h = +m[4]; mi = +m[5]; }
  } else if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const ms = Math.round((parseFloat(s) - 25569) * 86400000);
    const dt = new Date(ms);
    [y, mo, d, h, mi] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), dt.getUTCHours(), dt.getUTCMinutes()];
  } else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1900)) return null;
  const p = n => String(n).padStart(2, '0');
  const date = `${y}-${p(mo)}-${p(d)}`;
  return withTime ? `${date}T${p(h)}:${p(mi)}:00` : date;
}

const splitList = v => clean(v).split(/\s*[,;\n]\s*|\s+&\s+|\s+and\s+/i).map(clean).filter(Boolean);

// Which report is this?
export function detectReport(headers) {
  const f = finder(headers);
  if (f('Family Link') >= 0 && f('Camper names', 'Camper count') >= 0) return 'families';
  if (f('Amount', 'Transaction amount') >= 0 && (f('Family Link', 'Family', 'Family ID') >= 0)) return 'transactions';
  if (f('Family Link', 'Family ID', 'FamilyID', 'Household ID') >= 0 && f('Camper first name', 'First name', 'Camper name', 'Name', 'Camper Link', 'Camper ID', 'CamperID') >= 0) return 'campers';
  return null;
}

// ---------- Families report ----------
// Family columns this app has a place for (the rest of a families report's columns are kept in families.extra).
const FAMILY_COLS = ['Family ID', 'Family Link', 'Father title', 'Mother title', 'Father first name', 'Mother first name', 'Family last name', 'Last name',
  'Camper names', 'Marital status', 'Maiden name', 'Father phone', 'Mother phone', 'Father email', 'Mother email', 'Father occupation', 'Mother occupation',
  'Address', 'City', 'State', 'Zip', 'Affiliation', 'Total charges', 'Total payments', 'Balance', 'Pending payments', 'Upcoming autopay',
  'Balance after expected payments', 'Payment Methods', 'Active Autopay', 'Paused Autopay', 'Emergency Contact 1', 'Emergency Contact 2', 'Applied date'];
// Columns about the family that a campers report repeats on each camper's row; they belong to the family, not the camper.
const FAMILY_ONLY = FAMILY_COLS.concat(['Camper count', 'Country', 'Secondary country', 'Family Office Notes', 'Communication notes']);

// One family's details from a row (families report, or the family columns of a campers report).
function familyRecord(headers, r, col) {
  const money = k => moneyCents(col(r, k));
  const disclosureCols = headers.map((h, i) => [h, i]).filter(([h]) => /^disclosure\s*:/i.test(h));
  const known = new Set(FAMILY_COLS.map(norm));
  // Everything else about the family that the report has, under Camp Flow's own column names.
  const extra = {};
  headers.forEach((h, i) => { const k = norm(h); if (!k || known.has(k) || /^disclosure\s*:/i.test(h) || !FAMILY_ONLY.map(norm).includes(k)) return; const v = clean(r[i]); if (v) extra[clean(h)] = v; });
  return {
    family: {
      last_name: col(r, 'Family last name', 'Last name'),
      father_title: orNull(col(r, 'Father title')), mother_title: orNull(col(r, 'Mother title')),
      father_first: orNull(col(r, 'Father first name')), mother_first: orNull(col(r, 'Mother first name')),
      father_phone: orNull(col(r, 'Father phone')), mother_phone: orNull(col(r, 'Mother phone')),
      father_email: orNull(col(r, 'Father email').toLowerCase()), mother_email: orNull(col(r, 'Mother email').toLowerCase()),
      father_occupation: orNull(col(r, 'Father occupation')), mother_occupation: orNull(col(r, 'Mother occupation')),
      marital_status: orNull(col(r, 'Marital status')), maiden_name: orNull(col(r, 'Maiden name')),
      address: orNull(col(r, 'Address')), city: orNull(col(r, 'City')), state: orNull(col(r, 'State')), zip: orNull(col(r, 'Zip')),
      affiliation: orNull(col(r, 'Affiliation')),
      emergency_contacts: [col(r, 'Emergency Contact 1'), col(r, 'Emergency Contact 2')].filter(Boolean),
      disclosures: Object.fromEntries(disclosureCols.map(([h, i]) => [clean(h.replace(/^disclosure\s*:\s*/i, '')), clean(r[i])]).filter(([, v]) => v)),
      applied_at: parseDate(col(r, 'Applied date'), true),
      extra,
    },
    finance: {
      total_charges_cents: money('Total charges'), total_payments_cents: money('Total payments'), balance_cents: money('Balance'),
      pending_payments_cents: money('Pending payments'), upcoming_autopay: orNull(col(r, 'Upcoming autopay')),
      balance_after_expected_cents: money('Balance after expected payments'),
      payment_methods: col(r, 'Payment Methods') === '' ? null : parseInt(col(r, 'Payment Methods'), 10) || 0,
      active_autopay: orNull(col(r, 'Active Autopay')), paused_autopay: orNull(col(r, 'Paused Autopay')),
    },
  };
}

export function parseFamilies(rows) {
  const [headers, ...body] = rows;
  const f = finder(headers);
  const col = (r, ...names) => { const i = f(...names); return i >= 0 ? clean(r[i]) : ''; };
  const out = [], problems = [];
  body.forEach((r, n) => {
    if (r.every(c => !clean(c))) return;
    const id = familyIdFromLink(col(r, 'Family Link'));
    if (!id) { problems.push({ row: n + 2, problem: 'No Camp Flow family link' }); return; }
    const rec = familyRecord(headers, r, col);
    // A families report keeps every column it has: anything this app has no field for goes into extra.
    headers.forEach((h, i) => { const k = norm(h); if (!k || /^disclosure\s*:/i.test(h) || FAMILY_COLS.map(norm).includes(k) || k === norm('Family ID')) return; const v = clean(r[i]); if (v) rec.family.extra[clean(h)] = v; });
    out.push({ external_id: `campflow:${id}`, family: rec.family, camper_names: splitList(col(r, 'Camper names')), finance: rec.finance });
  });
  return { families: out, problems };
}

// ---------- Campers report (one row per camper) ----------
// Campers-report columns with a place in the app (or worked out from others: Full Name, Age).
const CAMPER_COLS = [['Family Link', 'Family ID', 'FamilyID', 'Household ID', 'Family'], ['Camper first name', 'First name', 'First'], ['Camper last name', 'Last name', 'Last'],
  ['Camper name', 'Name', 'Camper', 'Full Name'], ['Camper Link', 'Camper ID', 'CamperID', 'Child ID', 'Link'], ['Date of birth', 'DOB', 'Birthday', 'Birth date'], ['Gender', 'Sex'],
  ['Grade', 'Grade in fall', 'Current grade'], ['Sessions', 'Session', 'Programs', 'Program', 'Registered sessions'], ['Legal first name', 'Legal first'], ['Legal last name', 'Legal last'],
  ['Hebrew name', 'Hebrew'], ['Staff child', 'Staff kid', 'Staff'], ['Approval Status', 'Status'], ['Applied Date', 'Applied'], ['Accepted Date', 'Accepted'], ['Enrollment ID'], ['Age']];

export function parseCampers(rows) {
  const [headers, ...body] = rows;
  const f = finder(headers);
  const used = new Set();
  CAMPER_COLS.forEach(names => { const i = f(...names); if (i >= 0) used.add(i); });
  headers.forEach((h, i) => { if (FAMILY_ONLY.map(norm).includes(norm(h)) || /^disclosure\s*:/i.test(h)) used.add(i); });
  const col = (r, ...names) => { const i = f(...names); return i >= 0 ? clean(r[i]) : ''; };
  const out = [], problems = [];
  body.forEach((r, n) => {
    if (r.every(c => !clean(c))) return;
    const fam = familyIdFromLink(col(r, 'Family Link', 'Family ID', 'FamilyID', 'Household ID', 'Family'));
    let first = col(r, 'Camper first name', 'First name', 'First');
    let last = col(r, 'Camper last name', 'Last name', 'Last');
    if (!first) { const whole = col(r, 'Camper name', 'Name', 'Camper'); const parts = whole.split(' '); first = parts.shift() || ''; last = last || parts.join(' '); }
    if (!fam || !first) { problems.push({ row: n + 2, problem: !fam ? 'No Camp Flow family link' : 'No camper name' }); return; }
    const cid = camperIdFromLink(col(r, 'Camper Link', 'Camper ID', 'CamperID', 'Child ID', 'Link'));
    // Every other camper column (shirt size, school, allergies, ...) becomes a camper detail under Camp Flow's name for it.
    const extra = {};
    headers.forEach((h, i) => { if (!used.has(i) && clean(h)) { const v = clean(r[i]); extra[clean(h)] = v; } });
    out.push({
      family_external_id: `campflow:${fam}`,
      external_id: cid ? `campflow:camper:${cid}` : null,
      first_name: first, last_name: last,
      date_of_birth: parseDate(col(r, 'Date of birth', 'DOB', 'Birthday', 'Birth date')),
      gender: orNull(col(r, 'Gender', 'Sex')),
      grade: orNull(col(r, 'Grade', 'Grade in fall', 'Current grade')),
      sessions: splitList(col(r, 'Sessions', 'Session', 'Programs', 'Program', 'Registered sessions')),
      bunk: orNull(col(r, 'Bunk', 'Cabin', 'Group')),
      legal_first: orNull(col(r, 'Legal first name', 'Legal first')),
      legal_last: orNull(col(r, 'Legal last name', 'Legal last')),
      hebrew_name: orNull(col(r, 'Hebrew name', 'Hebrew')),
      staff_child: f('Staff child', 'Staff kid', 'Staff') >= 0 ? /^(y|yes|true|1|x)$/i.test(col(r, 'Staff child', 'Staff kid', 'Staff')) : null,
      approval_status: orNull(col(r, 'Approval Status', 'Status')),
      applied_at: parseDate(col(r, 'Applied Date', 'Applied'), true),
      accepted_at: parseDate(col(r, 'Accepted Date', 'Accepted'), true),
      campflow_enrollment_id: orNull(col(r, 'Enrollment ID')),
      extra,
      // The family's details, in case this report arrives before the families report that has the family.
      family: familyRecord(headers, r, col).family,
    });
  });
  return { campers: out, problems, extraColumns: headers.filter((h, i) => !used.has(i) && clean(h)).map(clean) };
}

// ---------- Transactions report (one row per charge or payment) ----------
export function parseTransactions(rows) {
  const [headers, ...body] = rows;
  const f = finder(headers);
  const col = (r, ...names) => { const i = f(...names); return i >= 0 ? clean(r[i]) : ''; };
  const out = [], problems = [];
  body.forEach((r, n) => {
    if (r.every(c => !clean(c))) return;
    const fam = familyIdFromLink(col(r, 'Family Link', 'Family ID', 'Family'));
    const cents = moneyCents(col(r, 'Amount', 'Transaction amount'));
    const date = parseDate(col(r, 'Date', 'Transaction date', 'Created'));
    if (!fam || cents == null || !date) { problems.push({ row: n + 2, problem: 'Missing family, amount or date' }); return; }
    const type = norm(col(r, 'Type', 'Transaction type', 'Kind'));
    const kind = /refund/.test(type) ? 'refund' : /discount|scholarship|credit/.test(type) ? 'discount'
      : /payment|paid/.test(type) ? 'payment' : /adjust/.test(type) ? 'adjustment' : /charge|fee|tuition|invoice/.test(type) ? 'charge'
      : cents < 0 ? 'payment' : 'charge';
    out.push({
      family_external_id: `campflow:${fam}`,
      external_id: orNull(col(r, 'Transaction ID', 'ID', 'Reference')),
      occurred_on: date, kind, description: orNull(col(r, 'Description', 'Memo', 'Item', 'Type')), amount_cents: Math.abs(cents),
    });
  });
  return { entries: out, problems };
}

// ---------- What an import changes ----------
// existing: { families: [{id, external_id, active}], campers: [{id, family_id, external_id, first_name, active, derived}] }
// A report much smaller than what's on file (for example a filtered report) never deactivates anyone.
export function planFamilies(parsed, existing, { minShare = 0.6 } = {}) {
  const byExt = new Map(existing.families.map(f => [f.external_id, f]));
  const seen = new Set(parsed.map(p => p.external_id));
  const activeNow = existing.families.filter(f => f.active).length;
  const safe = activeNow === 0 || parsed.length >= Math.ceil(activeNow * minShare);
  const deactivate = safe ? existing.families.filter(f => f.active && !seen.has(f.external_id)).map(f => f.id) : [];
  const reactivate = existing.families.filter(f => !f.active && seen.has(f.external_id)).map(f => f.id);
  return {
    insert: parsed.filter(p => !byExt.has(p.external_id)),
    update: parsed.filter(p => byExt.has(p.external_id)).map(p => ({ id: byExt.get(p.external_id).id, ...p })),
    deactivate, reactivate,
    skippedDeactivation: !safe && existing.families.some(f => f.active && !seen.has(f.external_id)),
  };
}

// Campers named in the families report (first names only), used until the camper report exists.
// Matches by family + first name; never touches campers that came from a camper report.
export function planDerivedCampers(parsedFamilies, familyIdByExt, existingCampers) {
  const insert = [], keep = new Set();
  for (const p of parsedFamilies) {
    const fid = familyIdByExt.get(p.external_id);
    if (!fid) continue;
    const mine = existingCampers.filter(c => c.family_id === fid);
    for (const name of p.camper_names) {
      const hit = mine.find(c => norm(c.first_name) === norm(name));
      if (hit) keep.add(hit.id);
      else insert.push({ family_id: fid, first_name: name, last_name: p.family.last_name, derived: true });
    }
  }
  const listed = new Set(parsedFamilies.map(p => familyIdByExt.get(p.external_id)));
  const deactivate = existingCampers.filter(c => c.derived && c.active && listed.has(c.family_id) && !keep.has(c.id)).map(c => c.id);
  return { insert, deactivate };
}

// Camper report rows: match by camper ID, else by family + first name (which upgrades a derived camper).
export function planCampers(parsed, familyIdByExt, existingCampers) {
  const byExt = new Map(existingCampers.filter(c => c.external_id).map(c => [c.external_id, c]));
  const insert = [], update = [], problems = [], used = new Set();
  for (const p of parsed) {
    const fid = familyIdByExt.get(p.family_external_id);
    if (!fid) { problems.push({ camper: `${p.first_name} ${p.last_name}`.trim(), problem: 'Family not found; import the families report first' }); continue; }
    let hit = p.external_id && byExt.get(p.external_id);
    if (!hit) hit = existingCampers.find(c => c.family_id === fid && !used.has(c.id) && norm(c.first_name) === norm(p.first_name) && (!c.external_id || c.external_id === p.external_id));
    const rec = { family_id: fid, external_id: p.external_id, first_name: p.first_name, last_name: p.last_name, date_of_birth: p.date_of_birth, gender: p.gender, grade: p.grade, derived: false };
    // Legal and Hebrew names and the staff-child flag only overwrite what's on file when the report has them.
    for (const k of ['legal_first', 'legal_last', 'hebrew_name', 'staff_child', 'approval_status', 'applied_at', 'accepted_at', 'campflow_enrollment_id']) if (p[k] != null) rec[k] = p[k];
    if (hit) { used.add(hit.id); update.push({ id: hit.id, ...rec, sessions: p.sessions, bunk: p.bunk, extra: p.extra || {} }); }
    else insert.push({ ...rec, sessions: p.sessions, bunk: p.bunk, extra: p.extra || {} });
  }
  return { insert, update, problems };
}

// The camper-detail key for a Camp Flow column: "cf_" and the column name (e.g. "Shirt Size" -> cf_shirt_size).
export function campflowDetailKey(header) {
  return ('cf_' + norm(header).replace(/ /g, '_')).slice(0, 40).replace(/_+$/, '');
}
