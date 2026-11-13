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
    return db;
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
    enrollments: { campers: ['one', 'campers', 'camper_id', 'id'], sessions: ['one', 'sessions', 'session_id', 'id'] },
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
  function embed(db, table, row, sel) {
    var out = Object.assign({}, row);
    topLevelRels(sel || '').forEach(function (r) {
      var rel = (RELS[table] || {})[r.name]; if (!rel) return;
      var matches = db[rel[1]].filter(function (x) { return x[rel[3]] === row[rel[2]]; }).map(function (x) { return embed(db, rel[1], x, r.sub); });
      out[r.name] = rel[0] === 'one' ? (matches[0] || null) : matches;
    });
    return out;
  }
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
  var newId = function (t) { return t + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  function client(email) {
    var key = KEY(email), db = null;
    try { db = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { db = null; }
    if (!db) db = build(email);
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
          rows.forEach(function (r) {
            if (st.op === 'upsert') {
              var keyCols = table === 'camper_health' ? ['camper_id'] : table === 'finance_accounts' ? ['family_id'] : ['id'];
              var hit = db[table].find(function (x) { return keyCols.every(function (k) { return x[k] === r[k]; }); });
              if (hit) { Object.assign(hit, r); return; }
            }
            if (!r.id && ['bunk_assignments', 'enrollments', 'camper_health', 'finance_accounts'].indexOf(table) < 0) r.id = newId(table);
            if (table === 'bunk_assignments' && db[table].some(function (x) { return x.bunk_id === r.bunk_id && x.camper_id === r.camper_id; })) return;
            db[table].push(r);
          });
          if (['submissions', 'staff', 'bunk_assignments', 'camper_health'].indexOf(table) >= 0) audit(st.op === 'upsert' ? 'update' : 'insert', table, table === 'staff' ? { email: rows[0].email, role: rows[0].role } : table === 'submissions' ? { status: rows[0].status } : null);
          save();
          return { data: st.one ? clone(rows[0]) : clone(rows), error: null };
        }
        if (st.op === 'update') {
          var hits = db[table].filter(test);
          hits.forEach(function (r) { Object.assign(r, clone(st.value)); });
          if (['submissions', 'camper_health'].indexOf(table) >= 0 && hits.length) audit('update', table, table === 'submissions' ? { status: st.value.status } : null);
          save();
          return { data: clone(hits), error: null };
        }
        if (st.op === 'delete') {
          var keep = db[table].filter(function (r) { return !test(r); });
          var gone = db[table].length - keep.length;
          db[table] = keep;
          if (gone && ['staff', 'bunk_assignments', 'submissions'].indexOf(table) >= 0) audit('delete', table, null);
          save();
          return { data: null, error: null };
        }
        var rows2 = db[table].map(function (r) { return embed(db, table, r, st.sel); }).filter(test);
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
      form_status: function (a) { return formStatus(db, a.p_session || null); },
      bunk_list: function (a) {
        return db.bunk_assignments.filter(function (x) { return x.bunk_id === a.p_bunk; }).map(function (x) {
          var c = db.campers.find(function (k) { return k.id === x.camper_id; }), h = db.camper_health.find(function (k) { return k.camper_id === x.camper_id; });
          return c && c.active ? { camper_id: c.id, first_name: c.first_name, last_name: c.last_name, grade: c.grade, alert: h ? h.alert : null } : null;
        }).filter(Boolean).sort(function (a, b) { return (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name); });
      },
      sfsp_connection: function () { var s = db.camp_secrets[0]; return { sfsp_camp_id: s.sfsp_camp_id, sfsp_form_url: s.sfsp_form_url, has_secret: true, last_message: null }; },
      set_sfsp_connection: function (a) { var s = db.camp_secrets[0]; s.sfsp_camp_id = a.p_sfsp_camp_id || s.sfsp_camp_id; s.sfsp_form_url = a.p_form_url || s.sfsp_form_url; save(); return null; },
      log_file_view: function () { return null; }
    };
    return {
      demo: true,
      from: from,
      rpc: function (name, args) {
        var f = rpcs[name];
        return Promise.resolve(f ? { data: clone(f(args || {})), error: null } : { data: null, error: { message: 'Not available in ' + NAME } });
      },
      storage: { from: function () { return {
        upload: function () { return Promise.resolve({ data: {}, error: null }); },
        createSignedUrl: function () { return Promise.resolve({ data: null, error: { message: 'Files aren\'t kept in ' + NAME + '. In your own camp, this opens the form.', expected: true } }); }
      }; } },
      portalView: function (familyId) { return portalView(db, familyId); },
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

  function clear(email) { try { sessionStorage.removeItem(KEY(email)); } catch (e) { } }

  root.DemoDB = { CAMP: CAMP, NAME: NAME, SFSP_PRACTICE_FORM: SFSP_PRACTICE_FORM, client: client, clear: clear, build: build, checkSubmission: checkSubmission, formStatus: formStatus };
})(typeof window !== 'undefined' ? window : globalThis);
