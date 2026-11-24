// Camp Test Site: a practice camp that runs entirely in the browser.
// Nothing here reaches the database. The camp is built from DemoSeed (the same families and campers as the SFSP app's
// Camp Test Site) plus sample forms, bunks, alerts and money; changes are kept in this tab's session storage only, and
// are wiped when the person opens a real camp, signs out or taps Start over.
// DemoDB.client(email) returns a stand-in for the parts of supabase-js the staff app uses (from / rpc / storage).
(function (root) {
  'use strict';
  var CAMP = 'demo', NAME = 'Camp Test Site';
  var KEY = function (email) { return 'roster-demo:' + (email || ''); };
  var SFSP_PRACTICE_FORM = 'https://wgcamps.com/apply.html?demo=1';

  var FATHERS = ['Yaakov','Moshe','Dovid','Shmuel','Yosef','Avraham','Chaim','Eliezer','Mordechai','Shlomo','Binyamin','Aryeh','Menachem','Yisroel','Pinchas','Tzvi','Nachum','Baruch','Reuven','Ephraim'];
  var MOTHERS = ['Sarah','Rivka','Rochel','Leah','Chana','Miriam','Devorah','Esther','Malka','Bracha','Shoshana','Tova','Chaya','Faigy','Rena','Gitty','Batsheva','Yehudis','Dina','Perel'];
  var HEB = { Jacob: 'Yaakov', David: 'Dovid', Ben: 'Binyamin', Sam: 'Shmuel', Noah: 'Noach', Jonah: 'Yonah', Gabe: 'Gavriel', Max: 'Mordechai', Josh: 'Yehoshua',
    Nate: 'Nesanel', Dani: 'Daniel', Ari: 'Aryeh', Avi: 'Avraham', Ezra: 'Ezra', Micah: 'Michah', Eitan: 'Eisan', Ava: 'Chava', Hannah: 'Chana', Mia: 'Miriam',
    Ella: 'Elisheva', Maya: 'Maya', Gila: 'Gila', Sara: 'Sarah', Talia: 'Tal', Noa: 'Noa', Liora: 'Liora', Naomi: 'Naami' };
  var ALERTS = [['Peanut allergy (anaphylaxis)', 'Peanut allergy, EpiPen', true], ['Tree nut allergy', 'Tree nut allergy, EpiPen', true], ['Asthma', 'Asthma, inhaler', false],
    ['Lactose intolerant', 'Lactose intolerant', false], ['Type 1 diabetes', 'Type 1 diabetes, see nurse', false], ['Bee sting allergy', 'Bee sting allergy, EpiPen', true],
    ['ADHD', 'Takes medication at breakfast (nurse)', false], ['Gluten (celiac)', 'Celiac, gluten free', false]];

  var uid = function (p, n) { return p + '-' + n; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var isoDay = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var addDays = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
  var addYears = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setFullYear(d.getFullYear() + n); return isoDay(d); };

  // ---------- The practice camp ----------
  function build(email) {
    var seed = root.DemoSeed.campers(new Date());
    var R = root.DemoSeed.demoRng(777);
    var pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var int = function (a, b) { return a + Math.floor(R() * (b - a + 1)); };
    var Y = seed.year, now = new Date().toISOString();
    var db = { camps: [], sessions: [], bunks: [], staff: [], families: [], campers: [], enrollments: [], bunk_assignments: [], requirements: [], submissions: [],
      camper_health: [], sfsp_forms: [], reminder_log: [], finance_accounts: [], finance_entries: [], import_runs: [], audit_log: [], camp_secrets: [] };

    db.camps.push({ id: CAMP, name: NAME, slug: 'test-site', settings: { deadline: Y + '-06-04', reply_to: 'office@example.com', phone: '(555) 010-0100', welcome_enabled: true, reminders_enabled: true } });
    var sess = {};
    seed.sessions.forEach(function (s) { var row = { id: 'sess-' + s.key, camp_id: CAMP, name: s.name, external_name: s.name, starts_on: s.start, ends_on: s.end }; db.sessions.push(row); sess[s.key] = row; });
    db.camp_secrets.push({ camp_id: CAMP, sfsp_camp_id: 'demo', sfsp_form_url: 'https://wgcamps.com/apply.html', has_secret: true });

    var reqs = [['sfsp', 'SFSP meal form', 'Summer Food Service Program income form', 'family', 'sfsp', false, {}],
      ['insurance', 'Health insurance', 'Insurance company, member ID and a photo of the front and back of the card', 'camper', 'upload', true,
        { fields: [{ key: 'carrier', label: 'Insurance company' }, { key: 'member_id', label: 'Member ID' }, { key: 'group', label: 'Group number', optional: true }, { key: 'holder', label: 'Policy holder' }], min_files: 1 }],
      ['physical', 'Physical exam', 'Signed by the doctor, dated within the last 12 months', 'camper', 'upload', true, { min_files: 1 }],
      ['immunizations', 'Immunization record', 'From the doctor or school', 'camper', 'upload', true, { min_files: 1 }],
      ['consent', 'Consent to treat', 'Permission for camp medical staff to treat your child', 'family', 'consent', true, { accept_disclosure: null, text: 'I give permission for the camp\'s medical staff to provide first aid and medical treatment to my child or children, and, in an emergency, to arrange treatment by a doctor or hospital if I cannot be reached.' }],
      ['medical_history', 'Medical history', 'Allergies, medical conditions and medications', 'camper', 'questionnaire', true, {}]];
    reqs.forEach(function (q, i) { db.requirements.push({ id: 'req-' + q[0], camp_id: CAMP, key: q[0], label: q[1], help: q[2], scope: q[3], kind: q[4], health: q[5], config: q[6], active: true, sort: (i + 1) * 10 }); });
    var req = function (k) { return 'req-' + k; };

    [[email, 'director', 'You'], ['office@example.com', 'office', 'Sample Office'], ['nurse@example.com', 'infirmary', 'Sample Nurse'], ['finance@example.com', 'finance', 'Sample Bookkeeper'],
     ['head.boys@example.com', 'head_counselor', 'Sample Head Counselor', 'sess-boys'], ['head.girls@example.com', 'head_counselor', 'Sample Head Counselor', 'sess-girls']]
      .forEach(function (s, i) { db.staff.push({ id: 'st-' + i, camp_id: CAMP, email: s[0], role: s[1], name: s[2], session_id: s[3] || null, bunk_id: null }); });

    var created = function (daysBefore) { return new Date(new Date(Y + '-06-04T12:00:00') - daysBefore * 864e5).toISOString(); };
    var kidsBySession = { boys: [], girls: [] };
    seed.families.forEach(function (f) {
      var fid = uid('fam', f.n), father = pick(FATHERS), mother = pick(MOTHERS), last = f.last;
      var street = int(10, 999) + ' Sample St';
      db.families.push({ id: fid, camp_id: CAMP, external_id: 'test:' + f.n, last_name: last, father_title: 'Mr.', father_first: father, mother_title: 'Mrs.', mother_first: mother,
        father_phone: '(555) 01' + int(0, 9) + '-' + int(1000, 9999), mother_phone: R() < 0.8 ? '(555) 01' + int(0, 9) + '-' + int(1000, 9999) : null,
        father_email: father.toLowerCase() + '.' + last.toLowerCase() + f.n + '@example.com', mother_email: R() < 0.7 ? mother.toLowerCase() + '.' + last.toLowerCase() + f.n + '@example.com' : null,
        address: street, city: 'Sampletown', state: 'NY', zip: '12000', affiliation: null,
        emergency_contacts: [pick(MOTHERS) + ' ' + pick(['Adler', 'Berg', 'Klein', 'Roth', 'Stern']) + ' (Aunt) - (555) 019-' + int(1000, 9999)],
        disclosures: { 'Medical Authorization': 'Yes', 'Photo/Video Release': R() < 0.9 ? 'Yes' : 'No' }, active: true, missing_since: null,
        reminders_paused_until: null, reminder_note: null, welcome_sent_at: created(int(60, 160)), applied_at: created(int(160, 220)), created_at: now, updated_at: now });
      if (f.sfsp) db.sfsp_forms.push({ camp_id: CAMP, form_id: 'sfsp-' + f.n, household: 'test:' + f.n, state: 'received', at: created(int(5, 40)) });
      var S0 = seed.sessions.find(function (s) { return s.key === f.session; });
      f.kids.forEach(function (k, j) {
        var cid = uid('kid', f.n + '-' + (j + 1));
        var dob = addDays(addYears(S0.start, -k.age), -int(0, 364));
        var grade = k.age >= 18 ? 'Post-high school' : (k.age - 5) + (k.age - 5 === 1 ? 'st' : k.age - 5 === 2 ? 'nd' : k.age - 5 === 3 ? 'rd' : 'th');
        db.campers.push({ id: cid, camp_id: CAMP, family_id: fid, external_id: 'test:' + f.n + ':c' + (j + 1), first_name: k.first, last_name: last,
          legal_first: null, legal_last: null, hebrew_name: HEB[k.first] || (R() < 0.6 ? k.first : null), date_of_birth: dob, gender: S0.gender, grade: grade,
          staff_child: f.staff, derived: false, active: true, created_at: now, updated_at: now });
        db.enrollments.push({ camper_id: cid, session_id: sess[f.session].id, camp_id: CAMP });
        kidsBySession[f.session].push({ id: cid, age: k.age });
      });
    });

    // Bunks: ten per session, grouped by age, with a few campers not placed yet.
    ['boys', 'girls'].forEach(function (key) {
      var list = kidsBySession[key].slice().sort(function (a, b) { return a.age - b.age || (a.id < b.id ? -1 : 1); });
      for (var b = 0; b < 10; b++) db.bunks.push({ id: 'bunk-' + key + '-' + (b + 1), camp_id: CAMP, session_id: sess[key].id, name: 'Bunk ' + (key === 'boys' ? b + 1 : b + 11), sort: b });
      list.forEach(function (k, i) { if (i % 41 === 7) return; db.bunk_assignments.push({ bunk_id: 'bunk-' + key + '-' + (Math.min(9, Math.floor(i / 25)) + 1), camper_id: k.id, camp_id: CAMP, assigned_by: 'head.' + key + '@example.com', assigned_at: now }); });
    });
    db.staff.push({ id: 'st-c1', camp_id: CAMP, email: 'counselor@example.com', role: 'counselor', name: 'Sample Counselor', session_id: 'sess-boys', bunk_id: 'bunk-boys-1' });

    // Forms: most are in, some waiting for the nurse, a few sent back, the rest missing.
    var subN = 0;
    var addSub = function (r, fam, camper, status, files, answers, by, daysBefore) {
      db.submissions.push({ id: 'sub-' + (++subN), camp_id: CAMP, requirement_id: req(r), family_id: fam, camper_id: camper, status: status, files: files || [], answers: answers || {},
        submitted_by: by || 'family', reject_reason: status === 'rejected' ? pick(['The photo is too blurry to read. Please send a clearer one.', 'The doctor\'s signature is missing.', 'This exam is more than 12 months old.']) : null,
        reviewed_by: status === 'approved' || status === 'rejected' ? 'nurse@example.com' : null, reviewed_at: status === 'approved' || status === 'rejected' ? created(int(1, daysBefore || 30)) : null,
        created_at: created(daysBefore || int(5, 120)) });
    };
    var outcome = function (pIn) { var x = R(); return x > pIn ? null : x < pIn * 0.72 ? 'approved' : x < pIn * 0.95 ? 'received' : 'rejected'; };
    db.families.forEach(function (fam) {
      if (R() < 0.9) addSub('consent', fam.id, null, 'received', [], { agree: true, signed_name: fam.father_first + ' ' + fam.last_name, signed_at: created(int(10, 120)) }, 'family', int(10, 120));
    });
    db.campers.forEach(function (c) {
      var o;
      if ((o = outcome(0.86))) addSub('insurance', c.family_id, c.id, o, [{ path: 'demo/card-' + c.id + '.jpg', name: 'insurance-card.jpg', type: 'image/jpeg' }],
        { carrier: pick(['Aetna', 'Empire BlueCross', 'UnitedHealthcare', 'Cigna', 'Fidelis Care', 'Oxford']), member_id: 'W' + int(10000000, 99999999), holder: 'Parent ' + c.last_name }, 'family');
      if ((o = outcome(0.8))) addSub('physical', c.family_id, c.id, o, [{ path: 'demo/physical-' + c.id + '.pdf', name: 'physical.pdf', type: 'application/pdf' }], {}, 'family');
      if ((o = outcome(0.83))) addSub('immunizations', c.family_id, c.id, o, [{ path: 'demo/imm-' + c.id + '.pdf', name: 'immunizations.pdf', type: 'application/pdf' }], {}, 'family');
      if (R() < 0.88) {
        if (R() < 0.75) addSub('medical_history', c.family_id, c.id, 'not_needed', [], { has_any: 'no' }, 'family');
        else {
          var a = pick(ALERTS);
          addSub('medical_history', c.family_id, c.id, R() < 0.8 ? 'approved' : 'received', [], { has_any: 'yes', allergies: /allerg/i.test(a[0]) ? a[0] : '', conditions: /allerg/i.test(a[0]) ? '' : a[0], epipen: a[2] }, 'family');
          db.camper_health.push({ camper_id: c.id, camp_id: CAMP, alert: a[1], allergies: /allerg/i.test(a[0]) ? a[0] : null, conditions: /allerg/i.test(a[0]) ? null : a[0], medications: null, updated_by: 'nurse@example.com', updated_at: created(int(1, 20)) });
        }
      }
    });

    // The sample counselor's bunk always shows what an alert looks like.
    db.bunk_assignments.filter(function (a) { return a.bunk_id === 'bunk-boys-1'; }).slice(2, 4).forEach(function (a, i) {
      if (db.camper_health.some(function (h) { return h.camper_id === a.camper_id; })) return;
      var al = ALERTS[i * 2];
      db.camper_health.push({ camper_id: a.camper_id, camp_id: CAMP, alert: al[1], allergies: /allerg/i.test(al[0]) ? al[0] : null, conditions: /allerg/i.test(al[0]) ? null : al[0], medications: null, updated_by: 'nurse@example.com', updated_at: now });
    });

    // Who can see what, plus one sample camper detail of the camp's own (T-shirt size).
    seedAccess(db);
    db.perm_items.push({ camp_id: CAMP, key: 'f_shirt', label: 'T-shirt size', help: null, kind: 'field', sort: 101 });
    db.permissions.push({ camp_id: CAMP, role_key: 'office', item_key: 'f_shirt', can_see: true, can_change: true }, { camp_id: CAMP, role_key: 'head_counselor', item_key: 'f_shirt', can_see: true, can_change: false });
    db.campers.forEach(function (c) { if (R() < 0.8) db.camper_fields.push({ camper_id: c.id, camp_id: CAMP, item_key: 'f_shirt', value: pick(['Youth M', 'Youth L', 'Adult S', 'Adult M', 'Adult L']), updated_by: 'office@example.com', updated_at: now }); });

    // Money: a read-only copy of Camp Flow's figures, as in a real camp this season.
    db.families.forEach(function (fam, i) {
      var kids = db.campers.filter(function (c) { return c.family_id === fam.id; }).length;
      var charges = kids * 385000 - (fam.father_first.length % 3 === 0 ? 20000 : 0);
      var paid = R() < 0.55 ? charges : Math.round(charges * pick([0, 0.25, 0.5, 0.75]) / 100) * 100;
      db.finance_accounts.push({ family_id: fam.id, camp_id: CAMP, total_charges_cents: charges, total_payments_cents: paid, balance_cents: charges - paid, pending_payments_cents: 0,
        upcoming_autopay: null, balance_after_expected_cents: charges - paid, payment_methods: 1, active_autopay: paid < charges && R() < 0.4 ? 'Monthly' : null, paused_autopay: null, source: 'campflow', as_of: now });
      db.finance_entries.push({ id: 'fe-c' + i, camp_id: CAMP, family_id: fam.id, external_id: 'c' + i, occurred_on: (Y - 1) + '-11-15', kind: 'charge', description: 'Tuition, ' + kids + ' camper' + (kids > 1 ? 's' : ''), amount_cents: charges, source: 'campflow', created_at: now });
      if (paid) db.finance_entries.push({ id: 'fe-p' + i, camp_id: CAMP, family_id: fam.id, external_id: 'p' + i, occurred_on: (Y - 1) + '-12-0' + int(1, 9), kind: 'payment', description: pick(['Card', 'Check', 'ACH']), amount_cents: paid, source: 'campflow', created_at: now });
    });

    db.families.slice(0, 40).forEach(function (fam, i) { db.reminder_log.push({ id: 'rl-' + i, camp_id: CAMP, family_id: fam.id, kind: i % 3 ? 'reminder' : 'welcome', sent_to: [fam.father_email], missing: [], provider_id: null, error: null, sent_by: null, sent_at: created(int(1, 60)) }); });
    db.import_runs.push({ id: 'ir-1', camp_id: CAMP, report: 'campers', file_name: 'campflow_campers.xlsx', via: 'email', counts: { campers: 500, added: 0, updated: 500, flagged: 0 }, problems: [], created_at: created(1) });
    db.import_runs.push({ id: 'ir-2', camp_id: CAMP, report: 'families', file_name: 'campflow_all_families.xlsx', via: 'email', counts: { families: db.families.length, added: 2, updated: db.families.length - 2, flagged: 0 }, problems: [], created_at: created(1) });
    [['nurse@example.com', 'update', 'submissions', { status: 'approved' }], ['head.boys@example.com', 'insert', 'bunk_assignments', null], ['office@example.com', 'view', 'file', null], [email, 'insert', 'staff', { email: 'counselor@example.com', role: 'counselor' }]]
      .forEach(function (a, i) { db.audit_log.push({ id: i + 1, camp_id: CAMP, actor: a[0], action: a[1], entity: a[2], entity_id: null, detail: a[3], at: created(i + 1) }); });
    // Divisions in the first session (a camp names its own), with its campers spread across them by grade.
    var s0 = db.sessions[0];
    db.divisions = [['div-1', 'Juniors', 1, null, '5th'], ['div-2', 'Seniors', 2, '6th', null]].map(function (d) { return { id: d[0], camp_id: CAMP, session_id: s0.id, name: d[1], sort: d[2], grade_min: d[3], grade_max: d[4], age_min: null, age_max: null }; });
    db.enrollments.forEach(function (e) {
      if (e.session_id !== s0.id) return;
      var c = db.campers.find(function (x) { return x.id === e.camper_id; }), g = parseInt(String(c && c.grade || '').replace(/\D/g, ''), 10);
      e.division_id = !isNaN(g) && g >= 6 ? 'div-2' : 'div-1';
    });
    // As in a Camp Flow campers report: most campers approved, some pending.
    db.campers.forEach(function (c, i) { c.approval_status = i % 7 === 3 ? 'Pending' : 'Approved'; });
    sampleReports(db);
    sampleApplications(db);
    return db;
  }

  // ---------- Daily registration report (the same as registration_report() in the database) ----------
  function reportData(db, from, to) {
    var inWin = function (t) { return t >= from && t < to; };
    var kids = db.campers.filter(function (c) { return c.active && inWin(c.created_at); });
    var fams = db.families.filter(function (f) { return f.active && kids.some(function (c) { return c.family_id === f.id; }); });
    var list = fams.map(function (f) {
      return { family_id: f.id, last_name: f.last_name, parents: [f.father_first, f.mother_first].filter(Boolean).join(' & '), new_family: f.created_at >= from, applied_at: f.applied_at,
        city: f.city, state: f.state, phone: f.father_phone || f.mother_phone, email: f.father_email || f.mother_email, campflow_id: String(f.external_id || '').replace(/^(campflow|test):/, ''),
        father: [f.father_title, f.father_first, f.last_name].filter(Boolean).join(' '), father_phone: f.father_phone, father_email: f.father_email, father_occupation: f.father_occupation || null,
        mother: [f.mother_title, f.mother_first, f.last_name].filter(Boolean).join(' '), mother_phone: f.mother_phone, mother_email: f.mother_email, mother_occupation: f.mother_occupation || null,
        address: [f.address, f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), zip: f.zip, affiliation: f.affiliation, emergency: (f.emergency_contacts || []).join('; '),
        balance_cents: (function () { var e = db.finance_entries.filter(function (x) { return x.family_id === f.id; }); return e.length ? e.reduce(function (t, x) { return t + (x.kind === 'payment' ? -x.amount_cents : x.amount_cents); }, 0) : null; })(),
        sfsp: (function () { var r = db.requirements.find(function (q) { return q.kind === 'sfsp' && q.active; }); return r ? statusFor(db, r, f, null) : null; })(),
        campers: kids.filter(function (c) { return c.family_id === f.id; }).sort(function (a, b) { return a.first_name.localeCompare(b.first_name); }).map(function (c) {
          var fields = {}; (db.camper_fields || []).forEach(function (x) { if (x.camper_id === c.id && x.value != null) fields[x.item_key] = x.value; });
          var h = (db.camper_health || []).find(function (x) { return x.camper_id === c.id; });
          return { id: c.id, name: (c.first_name + ' ' + c.last_name).trim(), first_name: c.first_name, last_name: c.last_name, grade: c.grade, gender: c.gender, dob: c.date_of_birth, hebrew_name: c.hebrew_name, staff_child: c.staff_child, fields: fields,
            legal_name: [c.legal_first, c.legal_last].filter(Boolean).join(' ') || null, campflow_camper_id: String(c.external_id || '').replace(/^(campflow:camper|test):?/, '') || null, alert: h ? h.alert : null,
            bunks: db.bunk_assignments.filter(function (a) { return a.camper_id === c.id; }).map(function (a) { var b = db.bunks.find(function (x) { return x.id === a.bunk_id; }); return b ? b.name : ''; }).filter(Boolean),
            missing_forms: db.requirements.filter(function (r) { return r.active && ['missing', 'rejected'].indexOf(statusFor(db, r, f, r.scope === 'camper' ? c.id : null)) >= 0; }).sort(function (a, b) { return a.sort - b.sort; }).map(function (r) { return r.label; }),
            sessions: db.enrollments.filter(function (e) { return e.camper_id === c.id; }).map(function (e) { var s = db.sessions.find(function (x) { return x.id === e.session_id; }); return s ? s.name : ''; }),
            divisions: db.enrollments.filter(function (e) { return e.camper_id === c.id && e.division_id; }).map(function (e) { var dv = (db.divisions || []).find(function (x) { return x.id === e.division_id; }); return dv ? dv.name : ''; }).filter(Boolean) };
        }) };
    }).sort(function (a, b) { return a.last_name.localeCompare(b.last_name) || a.parents.localeCompare(b.parents); });
    return { from: from, to: to, campers: kids.length, families: fams.length, new_families: fams.filter(function (f) { return f.created_at >= from; }).length, list: list };
  }
  // The practice camp: a week of sign-ups and the 8 a.m. reports they produced (none on Saturday; Sunday covers since Friday).
  function sampleReports(db) {
    var R = root.DemoSeed.demoRng(31), now = Date.now();
    var old = new Date(now - 200 * 864e5).toISOString();
    db.families.forEach(function (f) { f.created_at = old; }); db.campers.forEach(function (c) { c.created_at = old; });
    db.families.forEach(function (f) {
      if (R() > 0.04) return;
      var at = new Date(now - R() * 7 * 864e5).toISOString(), sibling = R() < 0.25;
      if (!sibling) { f.created_at = at; f.applied_at = at; }
      var kids = db.campers.filter(function (c) { return c.family_id === f.id; });
      (sibling ? kids.slice(-1) : kids).forEach(function (c) { c.created_at = at; });
    });
    db.daily_reports = [];
    var ends = [];
    for (var d = 0; d < 8; d++) { var t = new Date(now - d * 864e5); t.setHours(8, 0, 0, 0); if (t.getTime() <= now && t.getDay() !== 6) ends.push(t); }
    ends.sort(function (a, b) { return a - b; });
    ends.forEach(function (end, i) {
      if (i === 0) return;
      var from = ends[i - 1].toISOString(), to = end.toISOString(), y = end.getFullYear(), m = end.getMonth() + 1, day = end.getDate();
      db.daily_reports.push({ id: 'dr-' + i, camp_id: CAMP, report_date: y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day, period_start: from, period_end: to,
        data: reportData(db, from, to), sent_to: ['you (practice: no email is sent)'], error: null, created_at: to });
    });
  }

  // ---------- Online applications: a few to practice on ----------
  function sampleApplications(db) {
    var s1 = db.sessions[0], s2 = db.sessions[1] || db.sessions[0], now = Date.now();
    var ago = function (h) { return new Date(now - h * 3600e3).toISOString(); };
    var sib = db.families.find(function (f) { return f.father_email; }) || db.families[0];
    var app = function (id, email, status, hours, d) {
      return { id: id, camp_id: CAMP, kind: 'camper', user_id: 'demo', email: email, status: status, data: d, signature: status === 'draft' ? null : [d.father.first, d.last_name].join(' '),
        signed_at: status === 'draft' ? null : ago(hours), submitted_at: status === 'draft' ? null : ago(hours), decided_at: null, decided_by: null, office_note: null, family_id: null, created_at: ago(hours + 1), updated_at: ago(hours) };
    };
    db.applications = [
      app('app-1', 'goldberg.family@example.com', 'submitted', 5, { last_name: 'Goldberg', father: { first: 'Yaakov', phone: '(718) 555-0140', email: 'goldberg.family@example.com' }, mother: { first: 'Leah', phone: '(718) 555-0141', email: 'leah.g@example.com' },
        address: '14 Ocean Pkwy', city: 'Brooklyn', state: 'NY', zip: '11218', emergency: [{ name: 'Miriam Stern', relation: 'Grandmother', phone: '(718) 555-0199' }],
        campers: [{ first: 'Shimon', dob: '2015-05-12', gender: 'Male', grade: '5th', sessions: [s1.id] }, { first: 'Tzvi', dob: '2017-09-02', gender: 'Male', grade: '3rd', sessions: [s1.id, s2.id] }], notes: 'Shimon would love to be with his cousin.' }),
      // A sibling of a family already in the roster (same email): the page offers to add to that family.
      app('app-2', sib.father_email, 'submitted', 20, { last_name: sib.last_name, father: { first: sib.father_first, phone: sib.father_phone, email: sib.father_email }, mother: { first: sib.mother_first || '' },
        address: sib.address, city: sib.city, state: sib.state, zip: sib.zip, emergency: [{ name: 'Neighbor', phone: '(555) 555-0100' }],
        campers: [{ first: 'Baruch', dob: '2018-01-20', gender: 'Male', grade: '2nd', sessions: [s2.id] }] }),
      app('app-3', 'weiss@example.com', 'waitlisted', 70, { last_name: 'Weiss', father: { first: 'Moshe', phone: '(845) 555-0177', email: 'weiss@example.com' }, mother: {}, address: '9 Maple Ave', city: 'Monsey', state: 'NY', zip: '10952',
        emergency: [{ name: 'Rachel Weiss', relation: 'Aunt', phone: '(845) 555-0178' }], campers: [{ first: 'Ari', dob: '2014-11-30', gender: 'Male', grade: '6th', sessions: [s2.id] }] }),
      app('app-4', 'klein@example.com', 'draft', 2, { last_name: 'Klein', father: { first: 'Dov', email: 'klein@example.com' }, mother: {}, emergency: [{}], campers: [{ first: 'Eli' }] })
    ];
    db.camps[0].settings = Object.assign({}, db.camps[0].settings, { registration: { camper: { enabled: true, intro: 'Welcome! Fill in one application for your family.', agreement: '' },
      staff: { enabled: true, tax_form: 'choice', tax_when: 'apply', positions: ['Lifeguard', 'Canteen', 'Kitchen staff', 'Waiter', 'Counselor', 'Madrich', 'Leagues'] } } });
    // Staff: some already on the roster, and a few applications.
    var R = root.DemoSeed.demoRng(77), pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var firsts = ['Avi', 'Dovid', 'Eli', 'Moshe', 'Yosef', 'Shmuel', 'Chaim', 'Mendy', 'Yehuda', 'Aryeh', 'Baruch', 'Zevi', 'Nachum', 'Pinchas', 'Ari', 'Yaakov', 'Shimon', 'Gavriel'];
    var lasts = ['Stein', 'Katz', 'Levine', 'Gold', 'Rosen', 'Weiss', 'Klein', 'Adler', 'Berger', 'Friedman', 'Hirsch', 'Kaplan', 'Schwartz', 'Feld'];
    var jobs = [['Counselor', 14], ['Waiter', 6], ['Kitchen staff', 4], ['Lifeguard', 3], ['Canteen', 2], ['Madrich', 3], ['Leagues', 2]];
    db.staff_members = [];
    var n = 0;
    jobs.forEach(function (j) {
      for (var i = 0; i < j[1]; i++) {
        n++;
        var y = 2007 + Math.floor(R() * 4), first = pick(firsts), last = pick(lasts);
        db.staff_members.push({ id: 'stf-' + n, camp_id: CAMP, application_id: null, first_name: first, last_name: last, date_of_birth: y + '-0' + (1 + Math.floor(R() * 9)) + '-1' + Math.floor(R() * 9), gender: 'Male', hebrew_name: null,
          phone: '(732) 555-' + String(1000 + n).slice(-4), email: (first + '.' + last + n).toLowerCase() + '@example.com', address: n + ' Sample Ave', city: pick(['Lakewood', 'Brooklyn', 'Monsey', 'Passaic']), state: pick(['NJ', 'NY']), zip: '08701',
          school: pick(['Yeshiva Ner Yisroel', 'Mesivta Ateres Yaakov', 'Yeshiva of Far Rockaway', 'Beis Medrash Govoha']), grade: pick(['11th', '12th', 'Beis medrash / post high school']),
          positions: R() < 0.15 && j[0] !== 'Counselor' ? [j[0], 'Leagues'] : [j[0]], session_ids: R() < 0.6 ? [s1.id, s2.id] : [pick([s1.id, s2.id])],
          parents: { father: { first: pick(firsts), phone: '(732) 555-' + String(2000 + n).slice(-4) } }, emergency_contacts: [pick(firsts) + ' ' + last + ', Uncle, (732) 555-' + String(3000 + n).slice(-4)],
          experience: { camper: [{ camp: pick(['Camp Test Site', 'Camp Sameach', 'Camp Bnei Torah']), years: '2016-2020' }], staff: R() < 0.5 ? [{ camp: 'Camp Test Site', position: j[0], years: '2025' }] : [] },
          answers: {}, notes: null, active: true, created_by: 'sample', created_at: ago(500), updated_at: ago(500) });
      }
    });
    var st = function (id, email, status, hours, d) { var x = app(id, email, status, hours, d); x.kind = 'staff'; x.signature = status === 'draft' ? null : d.first + ' ' + d.last; return x; };
    var back = db.staff_members[0];
    db.applications.push(
      st('sapp-1', 'yehuda.adler@example.com', 'submitted', 8, { first: 'Yehuda', last: 'Adler', dob: '2009-02-11', gender: 'Male', phone: '(845) 555-0110', email: 'yehuda.adler@example.com', school: 'Mesivta Ateres Yaakov', grade: '11th',
        address: '22 Elm St', city: 'Monsey', state: 'NY', zip: '10952', positions: ['Lifeguard', 'Counselor'], sessions: [s1.id, s2.id], father: { first: 'Shlomo', phone: '(845) 555-0111' },
        emergency: [{ name: 'Rivka Adler', relation: 'Mother', phone: '(845) 555-0112' }], camper_experience: [{ camp: 'Camp Sameach', years: '2018-2022' }], staff_experience: [{ camp: 'Camp Sameach', position: 'Junior counselor', years: '2025' }], tax_form: { type: 'W-4', path: 'practice/sample-w4.pdf', name: 'W-4 Yehuda Adler.pdf', uploaded_at: ago(8) } }),
      st('sapp-2', 'nachum.feld@example.com', 'submitted', 30, { first: 'Nachum', last: 'Feld', dob: '2010-07-03', gender: 'Male', phone: '(732) 555-0177', email: 'nachum.feld@example.com', school: 'Yeshiva of Far Rockaway', grade: '10th',
        positions: ['Waiter', 'Kitchen staff'], sessions: [s2.id], father: { first: 'Dov', phone: '(732) 555-0178' }, emergency: [{ name: 'Leah Feld', phone: '(732) 555-0179' }], no_camper_experience: true, no_staff_experience: true }),
      // Returning staff: matched to their roster record by email.
      st('sapp-3', back.email, 'submitted', 50, { first: back.first_name, last: back.last_name, phone: back.phone, email: back.email, school: back.school, grade: back.grade, positions: ['Counselor'], sessions: [s1.id], father: back.parents.father,
        emergency: [{ name: 'Uncle', phone: '(732) 555-0100' }], camper_experience: back.experience.camper, staff_experience: [{ camp: 'Camp Test Site', position: back.positions[0], years: '2025' }] })
    );
  }

  // ---------- Statuses (the same rules as the database) ----------
  function tooOld(db, c) {
    if (!c.date_of_birth) return false;
    var starts = db.enrollments.filter(function (e) { return e.camper_id === c.id; }).map(function (e) { var s = db.sessions.find(function (x) { return x.id === e.session_id; }); return s && s.starts_on; }).filter(Boolean).sort();
    return starts.length ? addYears(c.date_of_birth, 19) <= starts[0] : false;
  }
  function statusFor(db, r, fam, camperId) {
    if (r.kind === 'sfsp') {
      if (db.sfsp_forms.some(function (x) { return x.household === fam.external_id && x.state === 'received'; })) return 'received';
      var kids = db.campers.filter(function (c) { return c.family_id === fam.id && c.active; });
      return kids.length && kids.every(function (c) { return tooOld(db, c); }) ? 'not_needed' : 'missing';
    }
    if (r.kind === 'consent' && r.config.accept_disclosure && String((fam.disclosures || {})[r.config.accept_disclosure] || '').toLowerCase() === 'yes') return 'approved';
    var best = null;
    db.submissions.forEach(function (s) {
      if (s.requirement_id !== r.id || s.family_id !== fam.id) return;
      if (r.scope === 'camper' ? s.camper_id !== camperId : s.camper_id) return;
      if (!best || s.created_at > best.created_at) best = s;
    });
    return best ? best.status : 'missing';
  }
  function formStatus(db, session) {
    var reqs = db.requirements.filter(function (r) { return r.active; });
    var fams = {}; db.families.forEach(function (f) { fams[f.id] = f; });
    return db.campers.filter(function (c) {
      return c.active && fams[c.family_id] && fams[c.family_id].active && (!session || db.enrollments.some(function (e) { return e.camper_id === c.id && e.session_id === session; }));
    }).map(function (c) {
      var f = fams[c.family_id], st = {}, missing = 0;
      reqs.forEach(function (r) { var s = statusFor(db, r, f, c.id); st[r.key] = s; if (s === 'missing' || s === 'rejected') missing++; });
      return { camper_id: c.id, family_id: c.family_id, first_name: c.first_name, last_name: c.last_name, grade: c.grade, family_name: f.last_name,
        sessions: db.enrollments.filter(function (e) { return e.camper_id === c.id; }).map(function (e) { return db.sessions.find(function (s) { return s.id === e.session_id; }).name; }),
        bunks: db.bunk_assignments.filter(function (a) { return a.camper_id === c.id; }).map(function (a) { return db.bunks.find(function (b) { return b.id === a.bunk_id; }).name; }),
        statuses: st, missing: missing, paused_until: f.reminders_paused_until };
    }).sort(function (a, b) { return a.family_name.localeCompare(b.family_name) || a.first_name.localeCompare(b.first_name); });
  }
  function portalView(db, familyId) {
    var f = db.families.find(function (x) { return x.id === familyId; });
    if (!f) return null;
    var camp = db.camps[0];
    var reqView = function (r, camperId) {
      var last = db.submissions.filter(function (s) { return s.requirement_id === r.id && s.family_id === f.id && (camperId ? s.camper_id === camperId : !s.camper_id); }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })[0];
      return { id: r.id, key: r.key, label: r.label, help: r.help, kind: r.kind, config: r.config, status: statusFor(db, r, f, camperId), reason: last && last.reject_reason };
    };
    var reqs = db.requirements.filter(function (r) { return r.active; }).sort(function (a, b) { return a.sort - b.sort; });
    return {
      family: { id: f.id, last_name: f.last_name, father: f.father_first, mother: f.mother_first },
      camp: { name: camp.name, deadline: camp.settings.deadline, phone: camp.settings.phone, email: camp.settings.reply_to },
      family_requirements: reqs.filter(function (r) { return r.scope === 'family'; }).map(function (r) { return reqView(r, null); }),
      campers: db.campers.filter(function (c) { return c.family_id === f.id && c.active; }).sort(function (a, b) { return a.first_name.localeCompare(b.first_name); })
        .map(function (c) { return { id: c.id, first_name: c.first_name, last_name: c.last_name, requirements: reqs.filter(function (r) { return r.scope === 'camper'; }).map(function (r) { return reqView(r, c.id); }) }; }),
      sfsp_link: SFSP_PRACTICE_FORM, demo: true
    };
  }

  // Same rules as supabase/functions/_shared/forms.js (tests/demo.test.mjs keeps them in step).
  function checkSubmission(requirement, input) {
    var files = Array.isArray(input && input.files) ? input.files.slice(0, 10) : [];
    var a = input && input.answers && typeof input.answers === 'object' ? input.answers : {};
    var cfg = requirement.config || {}, text = function (v, max) { return String(v == null ? '' : v).replace(/\s+$/g, '').slice(0, max || 2000).trim(); };
    if (requirement.kind === 'sfsp') return { error: 'The SFSP form is filled in on the SFSP site.' };
    if (requirement.kind === 'upload') {
      var answers = {};
      for (var i = 0; i < (cfg.fields || []).length; i++) { var f = cfg.fields[i], v = text(a[f.key], 200); if (!v && !f.optional) return { error: 'Please fill in ' + f.label + '.' }; if (v) answers[f.key] = v; }
      if (files.length < (cfg.min_files == null ? 1 : cfg.min_files)) return { error: 'Please add a photo or file of the form.' };
      return { status: 'received', answers: answers, files: files };
    }
    if (requirement.kind === 'consent') {
      var name = text(a.signed_name, 120);
      if (a.agree !== true) return { error: 'Please tick the box to give permission.' };
      if (name.length < 3) return { error: 'Please type your full name as your signature.' };
      return { status: 'received', answers: { agree: true, signed_name: name, text: cfg.text || '', signed_at: new Date().toISOString() }, files: [] };
    }
    if (requirement.kind === 'questionnaire') {
      if (a.has_any === 'no') return { status: 'not_needed', answers: { has_any: 'no' }, files: files };
      if (a.has_any !== 'yes') return { error: 'Please answer whether there are any allergies, medical conditions or medications.' };
      var ans = { has_any: 'yes' };
      ['allergies', 'conditions', 'medications', 'diet', 'other'].forEach(function (k) { var v = text(a[k]); if (v) ans[k] = v; });
      if (!ans.allergies && !ans.conditions && !ans.medications) return { error: 'Please describe the allergies, conditions or medications.' };
      ans.epipen = a.epipen === true; ans.inhaler = a.inhaler === true;
      return { status: 'received', answers: ans, files: files };
    }
    return { error: 'Unknown form type.' };
  }

  // ---------- A stand-in for supabase-js over the in-memory camp ----------
  var RELS = {
    campers: { families: ['one', 'families', 'family_id', 'id'], enrollments: ['many', 'enrollments', 'id', 'camper_id'], bunk_assignments: ['many', 'bunk_assignments', 'id', 'camper_id'], camper_health: ['one', 'camper_health', 'id', 'camper_id'] },
    enrollments: { campers: ['one', 'campers', 'camper_id', 'id'], sessions: ['one', 'sessions', 'session_id', 'id'], divisions: ['one', 'divisions', 'division_id', 'id'] },
    bunk_assignments: { bunks: ['one', 'bunks', 'bunk_id', 'id'], campers: ['one', 'campers', 'camper_id', 'id'] },
    finance_accounts: { families: ['one', 'families', 'family_id', 'id'] }
  };
  function topLevelRels(sel) { // "a, b(c(d)), e!inner(f)" -> [{name, inner, sub}]
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < sel.length; i++) {
      var ch = sel[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(function (p) { return p.indexOf('(') > 0; }).map(function (p) {
      var head = p.slice(0, p.indexOf('(')), sub = p.slice(p.indexOf('(') + 1, p.lastIndexOf(')'));
      return { name: head.replace(/!inner$/, ''), inner: /!inner$/.test(head), sub: sub };
    });
  }
  function embed(db, table, row, sel, visible) {
    var out = Object.assign({}, row);
    topLevelRels(sel || '').forEach(function (r) {
      var rel = (RELS[table] || {})[r.name]; if (!rel) return;
      var matches = db[rel[1]].filter(function (x) { return x[rel[3]] === row[rel[2]] && (!visible || visible(rel[1], x)); }).map(function (x) { return embed(db, rel[1], x, r.sub, visible); });
      out[r.name] = rel[0] === 'one' ? (matches[0] || null) : matches;
    });
    return out;
  }
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
  var newId = function (t) { return t + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  // ---------- Who can see what: the same defaults and rules as the database (migration 20261116000008). ----------
  var ROLE_DEFAULTS = [['director', 'Director', 'camp'], ['office', 'Office', 'camp'], ['finance', 'Finance', 'camp'], ['infirmary', 'Infirmary', 'camp'],
    ['head_counselor', 'Head counselor', 'session'], ['counselor', 'Counselor', 'bunk']];
  var ITEM_DEFAULTS = [['roster', 'Camper list', 'Names, grades, birth dates, sessions. Change: legal and Hebrew names, staff child'],
    ['parent_contacts', 'Parent contacts', 'Parents\' names, phones, emails, address, emergency contacts'],
    ['alerts', 'Medical alerts', 'The one-line alert, e.g. "Peanut allergy, EpiPen". Change: write the alert'],
    ['health_forms', 'Health forms', 'Uploaded forms and medical history. Change: approve, send back, add paper forms'],
    ['form_status', 'Forms checklist', 'Who is missing which form. Change: send reminders, pause them, family links'],
    ['bunks', 'Bunks', 'Bunk lists. Change: create bunks, move campers'], ['money', 'Money', 'Charges, payments and balances'],
    ['imports', 'Camp Flow imports', 'Import history. Change: import a report by hand'], ['setup', 'Sessions and required forms', 'Change: add sessions and dates, turn required forms on or off'],
    ['activity', 'Activity log', 'Who did what, and who opened which form'],
    ['reports', 'Daily registration report', 'New registrations each morning, and who it is emailed to'],
    ['applications', 'Applications', 'Online applications. Change: accept, waitlist or decline them, and set up online registration'],
    ['staff_roster', 'Staff roster', 'Everyone working at camp: contacts, positions, sessions. Change: hire, add and edit staff'],
    ['tax_forms', 'Staff tax forms', 'W-4 and W-9 forms staff upload (they include Social Security numbers). Change: add or remove them']];
  // [role, item, see, change]: tests/demo.test.mjs checks these match the database migration.
  var PERM_DEFAULTS = [['office', 'roster', 1, 1], ['office', 'parent_contacts', 1, 1], ['office', 'alerts', 1, 0], ['office', 'health_forms', 1, 0], ['office', 'form_status', 1, 1],
    ['office', 'bunks', 1, 1], ['office', 'imports', 1, 1], ['office', 'setup', 1, 1], ['finance', 'roster', 1, 0], ['finance', 'parent_contacts', 1, 0], ['finance', 'money', 1, 0],
    ['infirmary', 'roster', 1, 0], ['infirmary', 'parent_contacts', 1, 0], ['infirmary', 'alerts', 1, 1], ['infirmary', 'health_forms', 1, 1], ['infirmary', 'form_status', 1, 0], ['infirmary', 'bunks', 1, 0],
    ['head_counselor', 'roster', 1, 0], ['head_counselor', 'alerts', 1, 0], ['head_counselor', 'bunks', 1, 1], ['counselor', 'roster', 1, 0], ['counselor', 'alerts', 1, 0], ['counselor', 'bunks', 1, 0], ['office', 'reports', 1, 0], ['office', 'applications', 1, 1], ['office', 'staff_roster', 1, 1], ['finance', 'tax_forms', 1, 0]];
  function seedAccess(db) {
    db.roles = ROLE_DEFAULTS.map(function (r, i) { return { camp_id: CAMP, key: r[0], label: r[1], scope: r[2], builtin: true, sort: i + 1 }; });
    db.perm_items = ITEM_DEFAULTS.map(function (r, i) { return { camp_id: CAMP, key: r[0], label: r[1], help: r[2], kind: 'builtin', sort: i + 1 }; });
    db.permissions = PERM_DEFAULTS.map(function (p) { return { camp_id: CAMP, role_key: p[0], item_key: p[1], can_see: !!p[2], can_change: !!p[3] }; });
    db.camper_fields = [];
  }

  // "Viewing as" choices: each role, once per session or bunk when it's limited to one.
  var ROLE_KEY = function (email) { return 'roster-demo-role:' + (email || ''); };
  function viewOptions(db) {
    var out = [];
    db.roles.slice().sort(function (a, b) { return a.sort - b.sort; }).forEach(function (r) {
      if (r.scope === 'camp') out.push({ key: r.key, role: r.key, label: r.label });
      if (r.scope === 'session') db.sessions.forEach(function (s) { out.push({ key: r.key + '@' + s.id, role: r.key, label: r.label + ', ' + s.name, session_id: s.id }); });
      if (r.scope === 'bunk') { var b = db.bunks.find(function (x) { return x.id === 'bunk-boys-1'; }) || db.bunks[0]; if (b) out.push({ key: r.key + '@' + b.id, role: r.key, label: r.label + ', ' + b.name, session_id: b.session_id, bunk_id: b.id }); }
    });
    return out;
  }

  function client(email) {
    var key = KEY(email), db = null, me = null;
    var permOk = function (item, mode) {
      if (me.role === 'director') return true;
      var p = db.permissions.find(function (x) { return x.role_key === me.role && x.item_key === item; });
      return !!p && (p.can_change || (mode !== 'change' && p.can_see));
    };
    var scopeOf = function () { var r = db.roles.find(function (x) { return x.key === me.role; }); return me.role === 'director' ? 'camp' : (r ? r.scope : 'camp'); };
    var canAny = function (item, mode) { return permOk(item, mode); };
    var canCamper = function (camperId, item, mode) {
      if (!permOk(item, mode)) return false;
      var sc = scopeOf();
      if (sc === 'camp') return true;
      if (sc === 'session') return !me.session_id || db.enrollments.some(function (e) { return e.camper_id === camperId && e.session_id === me.session_id; });
      return db.bunk_assignments.some(function (a) { return a.camper_id === camperId && a.bunk_id === me.bunk_id; });
    };
    var canFamily = function (familyId, item, mode) {
      if (permOk(item, mode) && scopeOf() === 'camp') return true;
      return db.campers.some(function (c) { return c.family_id === familyId && canCamper(c.id, item, mode); });
    };
    var canBunk = function (bunkId, item, mode) {
      if (!permOk(item, mode)) return false;
      var b = db.bunks.find(function (x) { return x.id === bunkId; }), sc = scopeOf();
      if (!b) return false;
      return sc === 'camp' || (sc === 'session' && (!me.session_id || me.session_id === b.session_id)) || (sc === 'bunk' && me.bunk_id === b.id);
    };
    function visible(table, row) {
      switch (table) {
        case 'camps': case 'sessions': case 'divisions': case 'requirements': case 'bunks': case 'roles': case 'perm_items': case 'permissions': return true;
        case 'staff': return me.role === 'director';
        case 'families': return canFamily(row.id, 'parent_contacts', 'see');
        case 'campers': return canCamper(row.id, 'roster', 'see');
        case 'enrollments': return canCamper(row.camper_id, 'roster', 'see');
        case 'bunk_assignments': return canBunk(row.bunk_id, 'bunks', 'see') && canCamper(row.camper_id, 'roster', 'see');
        case 'submissions': return row.camper_id ? canCamper(row.camper_id, 'health_forms', 'see') : canFamily(row.family_id, 'health_forms', 'see');
        case 'camper_health': return canCamper(row.camper_id, 'health_forms', 'see');
        case 'camper_fields': return canCamper(row.camper_id, row.item_key, 'see');
        case 'sfsp_forms': return canAny('form_status', 'see');
        case 'reminder_log': return canFamily(row.family_id, 'form_status', 'see');
        case 'finance_accounts': case 'finance_entries': return canAny('money', 'see');
        case 'import_runs': return canAny('imports', 'see');
        case 'audit_log': return canAny('activity', 'see');
        case 'daily_reports': return canAny('reports', 'see');
        case 'applications': return canAny('applications', 'see');
        case 'staff_members': return canAny('staff_roster', 'see');
        default: return false;
      }
    }
    function writable(table, op, row) {
      switch (table) {
        case 'camps': case 'staff': case 'roles': case 'permissions': return me.role === 'director';
        case 'perm_items': return me.role === 'director' && (op !== 'insert' || row.kind === 'field');
        case 'sessions': case 'divisions': case 'requirements': case 'enrollments': return canAny('setup', 'change');
        case 'families': return canFamily(row.id, 'parent_contacts', 'change') || canFamily(row.id, 'form_status', 'change');
        case 'campers': return canCamper(row.id, 'roster', 'change');
        case 'bunks': var sc = scopeOf(); return permOk('bunks', 'change') && (sc === 'camp' || (sc === 'session' && (!me.session_id || me.session_id === row.session_id)));
        case 'bunk_assignments': return canBunk(row.bunk_id, 'bunks', 'change');
        case 'submissions': return op === 'delete' ? me.role === 'director' : (row.camper_id ? canCamper(row.camper_id, 'health_forms', 'change') : canFamily(row.family_id, 'health_forms', 'change'));
        case 'camper_health': return canCamper(row.camper_id, 'alerts', 'change');
        case 'camper_fields': return canCamper(row.camper_id, row.item_key, 'change');
        case 'applications': return op === 'update' && canAny('applications', 'change');
        case 'staff_members': return op === 'delete' ? me.role === 'director' : canAny('staff_roster', 'change');
        default: return false;
      }
    }
    var refused = function (msg) { return { data: null, error: { message: msg || ('As ' + me.label.toLowerCase() + ', you can\'t change this. In a real camp the database blocks it too.'), expected: true } }; };
    var notAllowed = function () { var e = new Error('not allowed'); e.denied = true; throw e; };
    try { db = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { db = null; }
    if (!db) db = build(email);
    if (!db.roles) seedAccess(db);
    var savedKey = null; try { savedKey = sessionStorage.getItem(ROLE_KEY(email)); } catch (e) { }
    var opts = viewOptions(db);
    me = opts.find(function (o) { return o.key === savedKey; }) || opts[0];
    var timer = null;
    var save = function () { clearTimeout(timer); timer = setTimeout(function () { try { sessionStorage.setItem(key, JSON.stringify(db)); } catch (e) { } }, 50); };
    save();
    var audit = function (action, entity, detail) { db.audit_log.push({ id: db.audit_log.length + 100, camp_id: CAMP, actor: email, action: action, entity: entity, entity_id: null, detail: detail || null, at: new Date().toISOString() }); };

    function from(table) {
      var st = { sel: '*', filters: [], orders: [], from: 0, to: Infinity, one: false, maybe: false, op: null, value: null, returning: false };
      var test = function (row) {
        return st.filters.every(function (f) {
          if (f.col.indexOf('.') > 0) { var p = f.col.split('.'), e = row[p[0]]; return e && (Array.isArray(e) ? e.some(function (x) { return x[p[1]] === f.val; }) : e[p[1]] === f.val); }
          var v = row[f.col];
          if (f.op === 'eq') return v === f.val || (f.val === true && v === undefined && f.col === 'active');
          if (f.op === 'in') return f.val.indexOf(v) >= 0;
          if (f.op === 'notin') return f.val.indexOf(v) < 0;
          return true;
        });
      };
      var run = function () {
        if (!db[table]) return { data: null, error: { message: 'Not available in ' + NAME } };
        if (st.op === 'insert' || st.op === 'upsert') {
          var rows = [].concat(st.value).map(function (v) { return Object.assign({ created_at: new Date().toISOString() }, v); });
          if (!rows.every(function (r) { return writable(table, 'insert', r); })) return refused();
          rows.forEach(function (r) {
            if (st.op === 'upsert') {
              var keyCols = table === 'camper_health' ? ['camper_id'] : table === 'finance_accounts' ? ['family_id'] : table === 'permissions' ? ['role_key', 'item_key'] : table === 'camper_fields' ? ['camper_id', 'item_key'] : ['id'];
              var hit = db[table].find(function (x) { return keyCols.every(function (k) { return x[k] === r[k]; }); });
              if (hit) { Object.assign(hit, r); return; }
            }
            if (!r.id && ['bunk_assignments', 'enrollments', 'camper_health', 'finance_accounts', 'roles', 'perm_items', 'permissions', 'camper_fields'].indexOf(table) < 0) r.id = newId(table);
            if (table === 'bunk_assignments' && db[table].some(function (x) { return x.bunk_id === r.bunk_id && x.camper_id === r.camper_id; })) return;
            db[table].push(r);
          });
          if (['submissions', 'staff', 'bunk_assignments', 'camper_health'].indexOf(table) >= 0) audit(st.op === 'upsert' ? 'update' : 'insert', table, table === 'staff' ? { email: rows[0].email, role: rows[0].role } : table === 'submissions' ? { status: rows[0].status } : null);
          save();
          return { data: st.one ? clone(rows[0]) : clone(rows), error: null };
        }
        if (st.op === 'update') {
          var hits = db[table].filter(function (r) { return visible(table, r) && test(r); });
          if (hits.length && !hits.every(function (r) { return writable(table, 'update', r); })) return refused();
          hits.forEach(function (r) { Object.assign(r, clone(st.value)); });
          if (['submissions', 'camper_health'].indexOf(table) >= 0 && hits.length) audit('update', table, table === 'submissions' ? { status: st.value.status } : null);
          save();
          return { data: clone(hits), error: null };
        }
        if (st.op === 'delete') {
          if (db[table].some(function (r) { return visible(table, r) && test(r) && !writable(table, 'delete', r); })) return refused();
          // The database's guards: the Director role, roles still in use and built-in items stay.
          var doomed = db[table].filter(function (r) { return visible(table, r) && test(r); });
          if (table === 'roles' && doomed.some(function (r) { return r.key === 'director'; })) return refused('The Director role can\'t be removed.');
          var inUse = table === 'roles' && doomed.find(function (r) { return db.staff.some(function (x) { return x.role === r.key; }); });
          if (inUse) return refused('Someone still has the ' + inUse.label + ' role. Change their role first.');
          if (table === 'perm_items' && doomed.some(function (r) { return r.kind === 'builtin'; })) return refused('Built-in items can\'t be removed; untick them instead.');
          if (table === 'roles') doomed.forEach(function (r) { db.permissions = db.permissions.filter(function (p) { return p.role_key !== r.key; }); });
          if (table === 'perm_items') doomed.forEach(function (r) { db.permissions = db.permissions.filter(function (p) { return p.item_key !== r.key; }); db.camper_fields = db.camper_fields.filter(function (f) { return f.item_key !== r.key; }); });
          var keep = db[table].filter(function (r) { return !(visible(table, r) && test(r)); });
          var gone = db[table].length - keep.length;
          db[table] = keep;
          if (gone && ['staff', 'bunk_assignments', 'submissions'].indexOf(table) >= 0) audit('delete', table, null);
          save();
          return { data: null, error: null };
        }
        var rows2 = db[table].filter(function (r) { return visible(table, r); }).map(function (r) { return embed(db, table, r, st.sel, visible); }).filter(test);
        st.orders.slice().reverse().forEach(function (o) {
          rows2.sort(function (a, b) { var x = a[o.col], y = b[o.col]; if (x == null && y == null) return 0; if (x == null) return o.nullsFirst ? -1 : 1; if (y == null) return o.nullsFirst ? 1 : -1; return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1); });
        });
        rows2 = rows2.slice(st.from, st.to === Infinity ? undefined : st.to + 1);
        if (st.one) { if (!rows2.length && !st.maybe) return { data: null, error: { message: 'Not found' } }; return { data: clone(rows2[0] || null), error: null }; }
        return { data: clone(rows2), error: null };
      };
      var b = {
        select: function (s) { if (st.op) st.returning = true; else st.sel = s || '*'; return b; },
        eq: function (c, v) { st.filters.push({ op: 'eq', col: c, val: v }); return b; },
        in: function (c, v) { st.filters.push({ op: 'in', col: c, val: v }); return b; },
        not: function (c, op, v) { if (op === 'in') st.filters.push({ op: 'notin', col: c, val: String(v).replace(/^\(|\)$/g, '').split(',') }); return b; },
        order: function (c, o) { st.orders.push({ col: c, asc: !(o && o.ascending === false), nullsFirst: !!(o && o.nullsFirst) }); return b; },
        range: function (a, z) { st.from = a; st.to = z; return b; },
        limit: function (n) { st.to = st.from + n - 1; return b; },
        single: function () { st.one = true; return b; },
        maybeSingle: function () { st.one = true; st.maybe = true; return b; },
        insert: function (v) { st.op = 'insert'; st.value = v; return b; },
        upsert: function (v) { st.op = 'upsert'; st.value = v; return b; },
        update: function (v) { st.op = 'update'; st.value = v; return b; },
        delete: function () { st.op = 'delete'; return b; },
        then: function (ok, bad) { var r; try { r = run(); } catch (e) { r = { data: null, error: { message: e.message } }; } return Promise.resolve(r).then(ok, bad); }
      };
      return b;
    }

    var rpcs = {
      form_status: function (a) { if (!canAny('form_status', 'see')) notAllowed(); return formStatus(db, a.p_session || null).filter(function (r) { return canCamper(r.camper_id, 'form_status', 'see'); }); },
      camper_alerts: function () { return db.camper_health.filter(function (h) { return h.alert && canCamper(h.camper_id, 'alerts', 'see'); }).map(function (h) { return { camper_id: h.camper_id, alert: h.alert }; }); },
      my_permissions: function () {
        var items = {}; db.perm_items.forEach(function (i) { items[i.key] = { see: permOk(i.key, 'see'), change: permOk(i.key, 'change'), label: i.label, kind: i.kind }; });
        var r = db.roles.find(function (x) { return x.key === me.role; }) || {};
        return { director: me.role === 'director', items: items, roles: [{ role: me.role, label: r.label, scope: scopeOf(), session_id: me.session_id || null, bunk_id: me.bunk_id || null }] };
      },
      assign_campflow_session: function () { if (me.role !== 'director') notAllowed(); return 0; },   // the practice camp has no Camp Flow families
      bunk_list: function (a) {
        if (!canBunk(a.p_bunk, 'bunks', 'see')) notAllowed();
        return db.bunk_assignments.filter(function (x) { return x.bunk_id === a.p_bunk; }).map(function (x) {
          var c = db.campers.find(function (k) { return k.id === x.camper_id; }), h = db.camper_health.find(function (k) { return k.camper_id === x.camper_id; });
          return c && c.active ? { camper_id: c.id, first_name: c.first_name, last_name: c.last_name, grade: c.grade, alert: h && canCamper(c.id, 'alerts', 'see') ? h.alert : null } : null;
        }).filter(Boolean).sort(function (a, b) { return (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name); });
      },
      sfsp_connection: function () { if (me.role !== 'director') return null; var s = db.camp_secrets[0]; return { sfsp_camp_id: s.sfsp_camp_id, sfsp_form_url: s.sfsp_form_url, has_secret: true, last_message: null }; },
      set_sfsp_connection: function (a) { if (me.role !== 'director') notAllowed(); var s = db.camp_secrets[0]; s.sfsp_camp_id = a.p_sfsp_camp_id || s.sfsp_camp_id; s.sfsp_form_url = a.p_form_url || s.sfsp_form_url; save(); return null; },
      log_file_view: function () { return null; },
      application_matches: function (a) {
        if (!canAny('applications', 'see')) notAllowed();
        var ap = db.applications.find(function (x) { return x.id === a.p_id; }); if (!ap) return [];
        var d = ap.data, digits = function (p) { return String(p || '').replace(/\D/g, '').slice(-10); };
        var emails = [d.father && d.father.email, d.mother && d.mother.email, ap.email].filter(Boolean).map(function (e) { return e.toLowerCase(); });
        var phones = [d.father && d.father.phone, d.mother && d.mother.phone].map(digits).filter(function (p) { return p.length === 10; });
        return db.families.filter(function (f) { return f.active; }).map(function (f) {
          var why = [];
          if ([f.father_email, f.mother_email].some(function (e) { return e && emails.indexOf(e.toLowerCase()) >= 0; })) why.push('same email');
          if ([f.father_phone, f.mother_phone].some(function (p) { return phones.indexOf(digits(p)) >= 0 && digits(p).length === 10; })) why.push('same phone');
          if ((f.last_name || '').toLowerCase() === (d.last_name || '').toLowerCase() && (f.father_first || '').toLowerCase() === ((d.father && d.father.first) || '-').toLowerCase()) why.push('same name');
          return why.length ? { family_id: f.id, last_name: f.last_name, parents: [f.father_first, f.mother_first].filter(Boolean).join(' & '), source: /^campflow:/.test(f.external_id) ? 'Camp Flow' : 'Online',
            campers: db.campers.filter(function (c) { return c.family_id === f.id && c.active; }).map(function (c) { return c.first_name; }).join(', '), why: why.join(', ') } : null;
        }).filter(Boolean).slice(0, 10);
      },
      accept_application: function (a) {
        if (!canAny('applications', 'change')) notAllowed();
        var ap = db.applications.find(function (x) { return x.id === a.p_id; });
        if (!ap || ['submitted', 'waitlisted'].indexOf(ap.status) < 0) throw new Error('This application has already been decided.');
        var d = ap.data, now = new Date().toISOString(), fam = a.p_family;
        if (!fam) {
          fam = 'fam-online-' + ap.id;
          db.families.push({ id: fam, camp_id: CAMP, external_id: 'online:' + ap.id, last_name: d.last_name || '', father_first: d.father.first || null, father_phone: d.father.phone || null, father_email: d.father.email || null,
            mother_first: (d.mother || {}).first || null, mother_phone: (d.mother || {}).phone || null, mother_email: (d.mother || {}).email || null, address: d.address || null, city: d.city || null, state: d.state || null, zip: d.zip || null,
            emergency_contacts: (d.emergency || []).filter(function (e) { return e && e.name; }).map(function (e) { return [e.name, e.relation, e.phone].filter(Boolean).join(', '); }), disclosures: {}, active: true, applied_at: ap.submitted_at, created_at: now, updated_at: now });
        }
        var form = (((db.camps[0].settings || {}).registration || {}).camper || {}).form || {}, qs = form.custom || [];
        var txt = function (v) { return Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)); };
        var extra = {};
        qs.filter(function (q) { return q.section !== 'camper'; }).forEach(function (q) { var v = txt((d.custom || {})[q.id]); if (v) extra[q.label] = v; });
        if (d.payment_plan_name) extra['Payment plan'] = d.payment_plan_name;
        if (d.notes) extra['Registration notes'] = d.notes;
        var famRow = db.families.find(function (f) { return f.id === fam; }); if (famRow) famRow.disclosures = Object.assign({}, famRow.disclosures, extra);
        db.camper_fields = db.camper_fields || [];
        (d.campers || []).forEach(function (k, n) {
          var id = 'cmp-online-' + ap.id + '-' + n;
          qs.filter(function (q) { return q.section === 'camper'; }).forEach(function (q) { var v = txt((k.custom || {})[q.id]); if (v && db.perm_items.some(function (i) { return i.key === 'f_reg_' + q.id; })) db.camper_fields.push({ camper_id: id, camp_id: CAMP, item_key: 'f_reg_' + q.id, value: v.slice(0, 500), updated_by: 'registration form' }); });
          db.campers.push({ id: id, camp_id: CAMP, family_id: fam, external_id: null, first_name: k.first, last_name: k.last || d.last_name || '', date_of_birth: k.dob || null, gender: k.gender || null, grade: k.grade || null, hebrew_name: k.hebrew_name || null, derived: false, active: true, created_at: now, updated_at: now });
          (k.sessions || []).forEach(function (sid) {
            if (!db.sessions.some(function (x) { return x.id === sid; })) return;
            var did = (k.divisions || {})[sid] || k.division, dv = (db.divisions || []).find(function (x) { return x.id === did && x.session_id === sid; });
            db.enrollments.push({ camper_id: id, session_id: sid, camp_id: CAMP, division_id: dv ? dv.id : null });
          });
        });
        Object.assign(ap, { status: 'accepted', family_id: fam, decided_by: email || 'you', decided_at: now });
        save();
        return fam;
      },
      staff_application_matches: function (a) {
        if (!canAny('applications', 'see')) notAllowed();
        var ap = db.applications.find(function (x) { return x.id === a.p_id; }); if (!ap) return [];
        var d = ap.data, digits = function (p) { return String(p || '').replace(/\D/g, '').slice(-10); };
        return db.staff_members.map(function (m) {
          var why = [];
          if (m.email && (m.email === ap.email || m.email === String(d.email || '').toLowerCase())) why.push('same email');
          if (digits(d.phone).length === 10 && digits(m.phone) === digits(d.phone)) why.push('same phone');
          if ((m.first_name || '').toLowerCase() === String(d.first || '').toLowerCase() && (m.last_name || '').toLowerCase() === String(d.last || '').toLowerCase()) why.push('same name');
          return why.length ? { member_id: m.id, name: (m.first_name + ' ' + m.last_name).trim(), positions: (m.positions || []).join(', '), why: why.join(', ') } : null;
        }).filter(Boolean).slice(0, 10);
      },
      hire_staff_application: function (a) {
        if (!canAny('applications', 'change')) notAllowed();
        var ap = db.applications.find(function (x) { return x.id === a.p_id; });
        if (!ap || ap.kind !== 'staff' || ['submitted', 'waitlisted'].indexOf(ap.status) < 0) throw new Error('This application has already been decided.');
        var pos = (a.p_positions || []).filter(Boolean); if (!pos.length) throw new Error('Choose at least one position.');
        var d = ap.data, now = new Date().toISOString();
        var rec = { application_id: ap.id, phone: d.phone || null, email: (d.email || ap.email || '').toLowerCase(), address: d.address || null, city: d.city || null, state: d.state || null, zip: d.zip || null, school: d.school || null, grade: d.grade || null,
          positions: pos, session_ids: (d.sessions || []).filter(function (x) { return db.sessions.some(function (q) { return q.id === x; }); }),
          parents: { father: d.father || {}, mother: d.mother || {} }, emergency_contacts: (d.emergency || []).filter(function (e) { return e && e.name; }).map(function (e) { return [e.name, e.relation, e.phone].filter(Boolean).join(', '); }),
          experience: { camper: d.camper_experience || [], staff: d.staff_experience || [] }, notes: d.notes || null, active: true, updated_at: now };
        var m;
        if (a.p_member) { m = db.staff_members.find(function (x) { return x.id === a.p_member; }); Object.assign(m, rec); }
        else { m = Object.assign({ id: 'stf-hired-' + ap.id, camp_id: CAMP, first_name: d.first, last_name: d.last || '', date_of_birth: d.dob || null, gender: d.gender || null, hebrew_name: d.hebrew_name || null, answers: {}, created_by: email || 'you', created_at: now }, rec); db.staff_members.push(m); }
        if (d.tax_form && d.tax_form.path) m.tax_form = d.tax_form;
        Object.assign(ap, { status: 'accepted', staff_member_id: m.id, decided_by: email || 'you', decided_at: now });
        save(); return m.id;
      },
      set_tax_setting: function (a) {
        if (!canAny('applications', 'change')) notAllowed();
        var c = db.camps[0]; c.settings = Object.assign({}, c.settings); c.settings.registration = Object.assign({}, c.settings.registration);
        c.settings.registration.staff = Object.assign({}, c.settings.registration.staff, { tax_form: a.p_form, tax_when: a.p_when }); save(); return null;
      },
      set_registration: function (a) {
        if (!canAny('applications', 'change')) notAllowed();
        var v = a.p_settings, out = { enabled: !!v.enabled, approval: a.p_kind === 'staff' ? true : v.approval !== false };
        if (a.p_kind === 'staff') { var prev = ((db.camps[0].settings || {}).registration || {}).staff || {}; if (prev.tax_form) out.tax_form = prev.tax_form; if (prev.tax_when) out.tax_when = prev.tax_when; }
        if (a.p_kind === 'staff' && Array.isArray(v.positions)) out.positions = v.positions.map(function (x) { return String(x).trim(); }).filter(Boolean);
        ['opens_on', 'closes_on', 'intro', 'agreement'].forEach(function (k) { if (v[k] && String(v[k]).trim()) out[k] = String(v[k]).trim(); });
        if (Array.isArray(v.sessions)) out.sessions = v.sessions;
        var form = v.form || {};
        out.form = { builtin: form.builtin || {}, custom: (form.custom || []).filter(function (q) { return /^[a-z0-9]{4,24}$/.test(q.id) && String(q.label || '').trim(); }) };
        out.payment = { plans: ((v.payment || {}).plans || []).filter(function (p) { return p.name; }).map(function (p) { return { id: p.id, name: p.name, description: p.description || undefined, link: /^https:\/\/\S+$/.test(p.link || '') ? p.link : undefined }; }),
          show: (v.payment || {}).show === 'after_send' ? 'after_send' : 'after_accept' };
        var c = db.camps[0]; c.settings = Object.assign({}, c.settings); c.settings.registration = Object.assign({}, c.settings.registration); c.settings.registration[a.p_kind] = out;
        // Camper questions become camper details.
        out.form.custom.filter(function (q) { return a.p_kind === 'camper' && q.section === 'camper'; }).forEach(function (q) {
          var key = 'f_reg_' + q.id, it = db.perm_items.find(function (i) { return i.key === key; });
          if (it) it.label = q.label.slice(0, 80);
          else {
            db.perm_items.push({ camp_id: CAMP, key: key, label: q.label.slice(0, 80), help: 'Asked on the registration form', kind: 'field', sort: 200 });
            if (!db.permissions.some(function (x) { return x.role_key === 'office' && x.item_key === key; })) db.permissions.push({ camp_id: CAMP, role_key: 'office', item_key: key, can_see: true, can_change: true });
          }
        });
        save(); return out;
      },
      report_now: function () {
        if (!canAny('reports', 'see')) notAllowed();
        var last = (db.daily_reports || []).map(function (r) { return r.period_end; }).sort().pop();
        var now = new Date(), to = now.toISOString(), from = last || new Date(now - 864e5).toISOString();
        var d = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var row = { id: 'dr-now-' + now.getTime(), camp_id: CAMP, report_date: d, period_start: from, period_end: to, data: reportData(db, from, to), sent_to: ['you (practice: no email is sent)'], error: null, manual: true, run_by: email || null, created_at: to };
        db.daily_reports.push(row); save();
        return { id: row.id, made: true, campers: row.data.campers, sent: 0 };
      },
      registration_preview: function () {
        if (!canAny('reports', 'see')) notAllowed();
        var last = (db.daily_reports || []).map(function (r) { return r.period_end; }).sort().pop();
        return reportData(db, last || new Date(Date.now() - 864e5).toISOString(), new Date().toISOString());
      }
    };
    return {
      demo: true,
      from: from,
      rpc: function (name, args) {
        var f = rpcs[name];
        if (!f) return Promise.resolve({ data: null, error: { message: 'Not available in ' + NAME } });
        try { return Promise.resolve({ data: clone(f(args || {})), error: null }); }
        catch (e) { return Promise.resolve({ data: null, error: { message: e.denied ? 'Your role can\'t see this.' : e.message, expected: !!e.denied } }); }
      },
      role: function () { return me; },
      roles: function () { return viewOptions(db); },
      setRole: function (k) { var o = viewOptions(db); me = o.find(function (r) { return r.key === k; }) || o[0]; try { sessionStorage.setItem(ROLE_KEY(email), me.key); } catch (e) { } return me; },
      storage: { from: function () { return {
        upload: function () { return Promise.resolve({ data: {}, error: null }); },
        createSignedUrl: function () { return Promise.resolve({ data: null, error: { message: 'Files aren\'t kept in ' + NAME + '. In your own camp, this opens the form.', expected: true } }); }
      }; } },
      portalView: function (familyId) { return portalView(db, familyId); },   // the family's own page: not limited by the staff role
      submit: function (familyId, body) {
        var r = db.requirements.find(function (x) { return x.id === body.requirement_id; });
        if (!r) return { error: 'That form is not on the list.' };
        var checked = checkSubmission(r, body);
        if (checked.error) return checked;
        db.submissions.push({ id: newId('sub'), camp_id: CAMP, requirement_id: r.id, family_id: familyId, camper_id: r.scope === 'camper' ? body.camper_id : null, status: checked.status,
          files: checked.files, answers: checked.answers, submitted_by: 'family', reject_reason: null, reviewed_by: null, reviewed_at: null, created_at: new Date().toISOString() });
        save();
        return { ok: true, submission: db.submissions[db.submissions.length - 1] };
      },
      addSubmission: function (s) { if (!db.submissions.some(function (x) { return x.id === s.id; })) { db.submissions.push(s); save(); } },
      reset: function () { try { sessionStorage.removeItem(key); } catch (e) { } }
    };
  }

  function clear(email) { try { sessionStorage.removeItem(KEY(email)); sessionStorage.removeItem(ROLE_KEY(email)); } catch (e) { } }

  root.DemoDB = { CAMP: CAMP, NAME: NAME, PERM_DEFAULTS: PERM_DEFAULTS, SFSP_PRACTICE_FORM: SFSP_PRACTICE_FORM, client: client, clear: clear, build: build, checkSubmission: checkSubmission, formStatus: formStatus };
})(typeof window !== 'undefined' ? window : globalThis);
