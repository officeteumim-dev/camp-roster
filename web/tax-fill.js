// Fills in and signs the official IRS W-4 or W-9 (web/irs/*.pdf, kept current by .github/workflows/irs-forms.yml)
// in the applicant's browser, with pdf-lib. The Social Security number goes only into the PDF, never into the app's data.
// Field names come from the 2026 W-4 and the March 2024 W-9 (see web/irs/fields.json); fill() refuses a form whose
// fields don't match, so a new IRS version can't be filled wrongly.
(function (root) {
  'use strict';
  var W4 = {
    first: 'topmostSubform[0].Page1[0].Step1a[0].f1_01[0]',      // (a) First name and middle initial
    last: 'topmostSubform[0].Page1[0].Step1a[0].f1_02[0]',       // Last name
    address: 'topmostSubform[0].Page1[0].Step1a[0].f1_03[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].Step1a[0].f1_04[0]',
    ssn: 'topmostSubform[0].Page1[0].f1_05[0]',                  // (b) Social security number, 11 characters
    single: 'topmostSubform[0].Page1[0].c1_1[0]',                // (c) Single or Married filing separately
    joint: 'topmostSubform[0].Page1[0].c1_1[1]',                 // Married filing jointly or Qualifying surviving spouse
    head: 'topmostSubform[0].Page1[0].c1_1[2]',                  // Head of household
    twoJobs: 'topmostSubform[0].Page1[0].c1_2[0]',               // Step 2(c)
    children: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]', // 3(a)
    others: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]',   // 3(b)
    step3: 'topmostSubform[0].Page1[0].f1_08[0]',                // Step 3 total
    otherIncome: 'topmostSubform[0].Page1[0].f1_09[0]',          // 4(a)
    deductions: 'topmostSubform[0].Page1[0].f1_10[0]',           // 4(b)
    extra: 'topmostSubform[0].Page1[0].f1_11[0]',                // 4(c)
    exempt: 'topmostSubform[0].Page1[0].c1_3[0]',                // Exempt from withholding
    employer: 'topmostSubform[0].Page1[0].f1_12[0]'              // Employer's name and address
  };
  var W9 = {
    name: 'topmostSubform[0].Page1[0].f1_01[0]',                 // 1 Name
    business: 'topmostSubform[0].Page1[0].f1_02[0]',             // 2 Business name
    individual: 'topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]', // 3a Individual/sole proprietor
    address: 'topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_07[0]',     // 5
    cityStateZip: 'topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_08[0]', // 6
    requester: 'topmostSubform[0].Page1[0].f1_09[0]',            // Requester's name and address
    ssn1: 'topmostSubform[0].Page1[0].f1_11[0]', ssn2: 'topmostSubform[0].Page1[0].f1_12[0]', ssn3: 'topmostSubform[0].Page1[0].f1_13[0]'
  };
  // Where the signature and date go (the forms have lines, not fields), in PDF points on page 1.
  var SIGN = { 'W-4': { sig: [104, 93], date: [470, 93] }, 'W-9': { sig: [124, 197], date: [430, 197] } };

  var money = function (n) { n = Math.round(Number(n) || 0); return n ? n.toLocaleString('en-US') : ''; };
  var ssnDigits = function (s) { return String(s || '').replace(/\D/g, ''); };
  // A believable SSN: 9 digits, not 000/666/9xx area, not 00 group, not 0000 serial.
  function validSsn(s) { var d = ssnDigits(s); return /^\d{9}$/.test(d) && !/^(000|666|9)/.test(d) && d.slice(3, 5) !== '00' && d.slice(5) !== '0000'; }
  // Step 3 amounts on the 2026 W-4 ($2,200 per qualifying child under 17, $500 per other dependent).
  function step3(a) { var c = (+a.kids || 0) * 2200, o = (+a.otherDeps || 0) * 500; return { c: c, o: o, total: c + o + (+a.otherCredits || 0) }; }

  // a: answers (see register.js). Returns the filled, flattened PDF as bytes.
  function fill(PDFLib, bytes, type, a, when) {
    return PDFLib.PDFDocument.load(bytes).then(function (doc) {
      var form = doc.getForm(), map = type === 'W-4' ? W4 : W9;
      var names = form.getFields().map(function (f) { return f.getName(); });
      Object.keys(map).forEach(function (k) { if (names.indexOf(map[k]) < 0) throw new Error('This ' + type + ' version has changed; the camp office needs to update the form filler.'); });
      var text = function (k, v) { if (v != null && v !== '') form.getTextField(map[k]).setText(String(v)); };
      // Boxes are marked with a drawn X after flattening (the forms' own check marks don't show in every viewer).
      var ticks = [];
      var tick = function (k) { form.getCheckBox(map[k]).acroField.getWidgets().forEach(function (w) { ticks.push(w.getRectangle()); }); };
      var d = ssnDigits(a.ssn);
      if (type === 'W-4') {
        text('first', [a.first, a.middle ? a.middle.charAt(0).toUpperCase() : ''].filter(Boolean).join(' '));
        text('last', a.last); text('address', a.address); text('cityStateZip', a.cityStateZip);
        text('ssn', d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5));
        tick({ single: 'single', joint: 'joint', head: 'head' }[a.status] || 'single');
        if (a.exempt) tick('exempt');
        else {
          if (a.twoJobs) tick('twoJobs');
          var s3 = step3(a);
          if (s3.total) { text('children', money(s3.c)); text('others', money(s3.o)); text('step3', money(s3.total)); }
          text('otherIncome', money(a.otherIncome)); text('deductions', money(a.deductions)); text('extra', money(a.extra));
        }
        if (a.employer) text('employer', a.employer);
      } else {
        text('name', a.name); text('business', a.business); tick('individual');
        text('address', a.address); text('cityStateZip', a.cityStateZip); if (a.requester) text('requester', a.requester);
        text('ssn1', d.slice(0, 3)); text('ssn2', d.slice(3, 5)); text('ssn3', d.slice(5));
      }
      // The IRS PDFs also carry an XFA copy of the form; drop it so every viewer shows these values.
      try { var acro = doc.catalog.lookup(PDFLib.PDFName.of('AcroForm')); if (acro) acro.delete(PDFLib.PDFName.of('XFA')); } catch (e) { }
      return Promise.all([doc.embedFont(PDFLib.StandardFonts.TimesRomanItalic), doc.embedFont(PDFLib.StandardFonts.Helvetica)]).then(function (fonts) {
        form.updateFieldAppearances(fonts[1]);
        form.flatten();
        var page = doc.getPages()[0], at = SIGN[type], ink = PDFLib.rgb(0.05, 0.12, 0.38);
        ticks.forEach(function (r) {
          var p = 1.6;
          page.drawLine({ start: { x: r.x + p, y: r.y + p }, end: { x: r.x + r.width - p, y: r.y + r.height - p }, thickness: 1.2, color: ink });
          page.drawLine({ start: { x: r.x + p, y: r.y + r.height - p }, end: { x: r.x + r.width - p, y: r.y + p }, thickness: 1.2, color: ink });
        });
        page.drawText(a.signature, { x: at.sig[0], y: at.sig[1], size: 15, font: fonts[0], color: ink });
        page.drawText(when.date, { x: at.date[0], y: at.date[1], size: 10, font: fonts[1] });
        // How it was signed, in small print under the signature.
        page.drawText('Signed electronically by ' + a.signature + ' (' + a.email + ') on ' + when.stamp + ' through Camp Roster.', { x: 36, y: 12, size: 6.5, font: fonts[1], color: PDFLib.rgb(0.35, 0.35, 0.35) });
        doc.setTitle('Form ' + type + ' - ' + (a.name || [a.first, a.last].join(' ')));
        return doc.save();
      });
    });
  }
  root.TaxFill = { W4: W4, W9: W9, SIGN: SIGN, fill: fill, validSsn: validSsn, ssnDigits: ssnDigits, step3: step3 };
})(typeof window !== 'undefined' ? window : globalThis);
