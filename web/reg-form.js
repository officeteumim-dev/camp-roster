// The registration form's questions: the standard ones, and how a camp's settings change them.
// Used by the parents' page (register.js) and the setup page in the app (app.js).
// A camp's settings.registration.camper.form = {
//   builtin: { <key>: { mode: 'required' | 'optional' | 'hidden', label, options } },
//   custom:  [ { id, section: 'family' | 'camper', label, type, options, required, help } ] }
(function (root) {
  'use strict';
  var GRADES = ['Pre-K', 'K', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
  // lock: always asked and required. mode: the standard setting.
  var BUILTIN = [
    { key: 'last_name', section: 'family', label: 'Family last name', lock: true },
    { key: 'address', section: 'family', label: 'Street address', mode: 'required' },
    { key: 'city', section: 'family', label: 'City', mode: 'required' },
    { key: 'state', section: 'family', label: 'State', mode: 'required' },
    { key: 'zip', section: 'family', label: 'ZIP code', mode: 'required' },
    { key: 'parent.first', section: 'parents', label: 'First name', lock: true, note: 'Asked for each parent; at least one parent is required' },
    { key: 'parent.title', section: 'parents', label: 'Title', mode: 'optional' },
    { key: 'parent.maiden', section: 'parents', label: 'Maiden name (mother)', mode: 'optional' },
    { key: 'parent.phone', section: 'parents', label: 'Cell phone', mode: 'required' },
    { key: 'parent.email', section: 'parents', label: 'Email', lock: true },
    { key: 'parent.occupation', section: 'parents', label: 'Occupation', mode: 'optional' },
    { key: 'emergency', section: 'emergency', label: 'Emergency contact (name and phone)', mode: 'required' },
    { key: 'emergency.relation', section: 'emergency', label: 'Relationship', mode: 'optional' },
    { key: 'camper.first', section: 'camper', label: 'First name', lock: true },
    { key: 'camper.last', section: 'camper', label: 'Last name (if different)', mode: 'optional' },
    { key: 'camper.dob', section: 'camper', label: 'Date of birth', mode: 'required' },
    { key: 'camper.grade', section: 'camper', label: 'Grade in September', mode: 'required', choices: true },
    { key: 'camper.gender', section: 'camper', label: 'Gender', mode: 'required' },
    { key: 'camper.hebrew_name', section: 'camper', label: 'Hebrew name', mode: 'optional' },
    { key: 'camper.sessions', section: 'camper', label: 'Sessions', mode: 'required', note: 'Only asked when the camp offers sessions' },
    { key: 'notes', section: 'other', label: 'Notes for the camp office', mode: 'optional' }
  ];
  // Staff applications: the applicant fills it in themselves (usually older teens).
  var STAFF_GRADES = ['9th', '10th', '11th', '12th', 'Beis medrash / post high school', 'College', 'Adult'];
  var POSITIONS = ['Lifeguard', 'Canteen', 'Kitchen staff', 'Waiter', 'Counselor', 'Madrich', 'Leagues'];
  var STAFF_BUILTIN = [
    { key: 'first', section: 'applicant', label: 'First name', lock: true },
    { key: 'last', section: 'applicant', label: 'Last name', lock: true },
    { key: 'dob', section: 'applicant', label: 'Date of birth', mode: 'required' },
    { key: 'gender', section: 'applicant', label: 'Gender', mode: 'required' },
    { key: 'phone', section: 'applicant', label: 'Your cell phone', mode: 'required' },
    { key: 'email', section: 'applicant', label: 'Your email', lock: true },
    { key: 'hebrew_name', section: 'applicant', label: 'Hebrew name', mode: 'optional' },
    { key: 'address', section: 'applicant', label: 'Street address', mode: 'required' },
    { key: 'city', section: 'applicant', label: 'City', mode: 'required' },
    { key: 'state', section: 'applicant', label: 'State', mode: 'required' },
    { key: 'zip', section: 'applicant', label: 'ZIP code', mode: 'required' },
    { key: 'school', section: 'applicant', label: 'School / yeshiva', mode: 'required' },
    { key: 'grade', section: 'applicant', label: 'Grade or year in September', mode: 'required', choices: true },
    { key: 'positions', section: 'job', label: 'Positions you\'re applying for', lock: true, note: 'The choices are your positions list below' },
    { key: 'sessions', section: 'job', label: 'Sessions you can work', mode: 'required', note: 'Only asked when the camp offers sessions' },
    { key: 'parent.first', section: 'parents', label: 'Parent\'s first name', mode: 'required', note: 'Asked for each parent; at least one when required' },
    { key: 'parent.phone', section: 'parents', label: 'Parent\'s cell phone', mode: 'required' },
    { key: 'parent.email', section: 'parents', label: 'Parent\'s email', mode: 'optional' },
    { key: 'emergency', section: 'emergency', label: 'Emergency contact (name and phone)', mode: 'required' },
    { key: 'emergency.relation', section: 'emergency', label: 'Relationship', mode: 'optional' },
    { key: 'experience.camper', section: 'experience', label: 'Camps you went to as a camper', mode: 'required', note: 'Camp and years; they can answer "none"' },
    { key: 'experience.staff', section: 'experience', label: 'Camps you worked at', mode: 'required', note: 'Camp, position and years; they can answer "none"' },
    { key: 'notes', section: 'other', label: 'Anything else we should know?', mode: 'optional' }
  ];
  var STAFF_SECTIONS = [['applicant', 'About you'], ['job', 'The job'], ['parents', 'Parents'], ['emergency', 'Emergency contact'], ['experience', 'Camp experience'], ['other', 'Anything else']];
  var TYPES = [['text', 'Short answer'], ['long', 'Long answer'], ['yesno', 'Yes / No'], ['choice', 'Choose one'], ['multi', 'Choose any'], ['date', 'Date'], ['number', 'Number']];
  var SECTIONS = [['family', 'Family'], ['parents', 'Parents'], ['emergency', 'Emergency contacts'], ['camper', 'Each camper'], ['other', 'Anything else']];

  // One question as this camp has it: { key, label, mode ('required' | 'optional' | 'hidden'), options }.
  function builtin(kind) { return kind === 'staff' ? STAFF_BUILTIN : BUILTIN; }
  function sections(kind) { return kind === 'staff' ? STAFF_SECTIONS : SECTIONS; }
  function field(form, key, kind) {
    var b = builtin(kind).find(function (x) { return x.key === key; }), o = ((form || {}).builtin || {})[key] || {};
    if (!b) return null;
    var std = kind === 'staff' ? STAFF_GRADES : GRADES;
    return { key: key, label: o.label || b.label, mode: b.lock ? 'required' : (o.mode || b.mode), lock: !!b.lock,
      options: b.choices ? ((o.options && o.options.length) ? o.options : std) : null };
  }
  function custom(form, section) { return ((form || {}).custom || []).filter(function (q) { return !section || q.section === section; }); }
  // A short, stable key for a new question (also its camper-detail key for camper questions).
  function newId() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function detailKey(q) { return 'f_reg_' + q.id; }

  // Does a camper fit a division's limits? grades: the form's grade list (in order); on: the session's first day.
  // Returns '' when they fit (or we can't tell yet), otherwise what the division is for.
  function ageOn(dob, on) {
    if (!dob) return null;
    var b = new Date(dob + 'T12:00:00'), d = on ? new Date(on + 'T12:00:00') : new Date(), a = d.getFullYear() - b.getFullYear();
    if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--;
    return a;
  }
  function limitsText(dv) {
    var g = dv.grade_min || dv.grade_max ? (dv.grade_min && dv.grade_max ? (dv.grade_min === dv.grade_max ? dv.grade_min + ' grade' : 'grades ' + dv.grade_min + '–' + dv.grade_max) : dv.grade_min ? dv.grade_min + ' grade and up' : 'up to ' + dv.grade_max + ' grade') : '';
    var a = dv.age_min != null || dv.age_max != null ? (dv.age_min != null && dv.age_max != null ? 'ages ' + dv.age_min + '–' + dv.age_max : dv.age_min != null ? 'ages ' + dv.age_min + ' and up' : 'up to age ' + dv.age_max) : '';
    return [g, a].filter(Boolean).join(', ');
  }
  function divisionFits(dv, kid, grades, on) {
    if (!dv) return '';
    var bad = false, gi = kid.grade ? grades.indexOf(kid.grade) : -1;
    if (gi >= 0) {
      if (dv.grade_min && grades.indexOf(dv.grade_min) >= 0 && gi < grades.indexOf(dv.grade_min)) bad = true;
      if (dv.grade_max && grades.indexOf(dv.grade_max) >= 0 && gi > grades.indexOf(dv.grade_max)) bad = true;
    }
    var age = ageOn(kid.dob, on);
    if (age != null) {
      if (dv.age_min != null && age < dv.age_min) bad = true;
      if (dv.age_max != null && age > dv.age_max) bad = true;
    }
    return bad ? limitsText(dv) : '';
  }

  // The standard consents (a camp can edit the wording, turn one off, or add its own). Starting wording only:
  // each camp should have its own attorney review it.
  function defaultConsents(kind, camp) {
    camp = camp || 'the camp';
    if (kind === 'staff') return [{ id: 'background_check', title: 'Consent to pre-employment background check', enabled: true, text:
      'I understand that, as part of considering my application and as required by law for staff of children\'s camps, ' + camp + ' will check my background before I begin work and each year that I return.\n\n' +
      'I authorize ' + camp + ' and those acting for it to:\n' +
      '• search the New York State Sex Offender Registry and the U.S. Department of Justice National Sex Offender Public Website using my name and date of birth;\n' +
      '• contact the references, schools, camps and employers I have listed, and I authorize them to share information about my character, conduct and work with children;\n' +
      '• make other background inquiries permitted by law for a position working with children.\n\n' +
      'I certify that the information in my application is true and complete, and that I have never been convicted of, or required to register for, a sex offense or an offense involving a child. I understand that false or missing information, or the results of these checks, may lead to my application being declined or my employment ending.\n\n' +
      'This consent stays in effect for as long as I am an applicant or staff member of ' + camp + '.' }];
    return [{ id: 'assumption_of_risk', title: 'Assumption of risk and consent to participate', enabled: true, text:
      'I am the parent or legal guardian of the camper(s) named in this application, and I give permission for them to attend ' + camp + ' and take part in its program.\n\n' +
      'I understand that camp activities include sports and leagues, swimming and waterfront activities, hiking, trips and travel by vehicle, outdoor and overnight activities, and living in a group setting, and that these carry risks that cannot be removed entirely, including illness, minor and serious injury, and loss of or damage to property. I have considered these risks and I accept them on behalf of myself and my camper(s).\n\n' +
      'I agree that my camper(s) will follow the camp\'s rules and the directions of its staff, and I understand that a camper whose behavior endangers themselves or others may be sent home.\n\n' +
      'To the fullest extent the law allows, I release ' + camp + ', its directors, staff and volunteers from claims for injury, illness or loss arising from the ordinary risks of taking part in camp. This does not release claims that the law does not allow to be released.\n\n' +
      'I confirm that my camper(s) are able to take part in the camp program, and that I have told the camp about any medical condition, allergy or limitation that staff should know about.' }];
  }
  // The consents a form shows: the camp's own list if it has one, otherwise the standard ones.
  function consents(saved, kind, camp) { return (Array.isArray(saved) ? saved : defaultConsents(kind, camp)).filter(function (c) { return c && c.enabled !== false && c.title && c.text; }); }

  root.RegForm = { defaultConsents: defaultConsents, consents: consents, GRADES: GRADES, STAFF_GRADES: STAFF_GRADES, POSITIONS: POSITIONS, BUILTIN: BUILTIN, STAFF_BUILTIN: STAFF_BUILTIN, TYPES: TYPES, SECTIONS: SECTIONS, STAFF_SECTIONS: STAFF_SECTIONS,
    builtin: builtin, sections: sections, field: field, custom: custom, newId: newId, detailKey: detailKey, divisionFits: divisionFits, limitsText: limitsText, ageOn: ageOn };
})(typeof window !== 'undefined' ? window : globalThis);
