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
  var TYPES = [['text', 'Short answer'], ['long', 'Long answer'], ['yesno', 'Yes / No'], ['choice', 'Choose one'], ['multi', 'Choose any'], ['date', 'Date'], ['number', 'Number']];
  var SECTIONS = [['family', 'Family'], ['parents', 'Parents'], ['emergency', 'Emergency contacts'], ['camper', 'Each camper'], ['other', 'Anything else']];

  // One question as this camp has it: { key, label, mode ('required' | 'optional' | 'hidden'), options }.
  function field(form, key) {
    var b = BUILTIN.find(function (x) { return x.key === key; }), o = ((form || {}).builtin || {})[key] || {};
    if (!b) return null;
    return { key: key, label: o.label || b.label, mode: b.lock ? 'required' : (o.mode || b.mode), lock: !!b.lock,
      options: key === 'camper.grade' ? ((o.options && o.options.length) ? o.options : GRADES) : null };
  }
  function custom(form, section) { return ((form || {}).custom || []).filter(function (q) { return !section || q.section === section; }); }
  // A short, stable key for a new question (also its camper-detail key for camper questions).
  function newId() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function detailKey(q) { return 'f_reg_' + q.id; }

  root.RegForm = { GRADES: GRADES, BUILTIN: BUILTIN, TYPES: TYPES, SECTIONS: SECTIONS, field: field, custom: custom, newId: newId, detailKey: detailKey };
})(typeof window !== 'undefined' ? window : globalThis);
