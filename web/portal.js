// Family portal: one page per family, opened from the emailed link (portal.html?t=...).
(function () {
  'use strict';
  var cfg = window.ROSTER_CONFIG;
  var token = new URLSearchParams(location.search).get('t') || '';
  // Camp Test Site: portal.html?demo=<family> shows that practice family's page from the test camp kept in this browser.
  var demoFamily = new URLSearchParams(location.search).get('demo') || '';
  var demo = null;
  if (demoFamily && window.DemoDB) {
    var demoEmail = ''; try { demoEmail = sessionStorage.getItem('roster-demo-current') || ''; } catch (e) { }
    demo = window.DemoDB.client(demoEmail);
    demo.email = demoEmail;
    token = 'demo';
  }
  var app = document.getElementById('app');
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
  var state = { data: null, open: null, drafts: {} };

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var DONE = { approved: 1, received: 1, not_needed: 1 };

  function call(action, extra) {
    if (demo) return new Promise(function (resolve, reject) {
      if (action === 'view') { var v = demo.portalView(demoFamily); return v ? resolve(v) : reject(new Error('This practice family isn\'t in ' + window.DemoDB.NAME + ' any more.')); }
      if (action === 'upload-urls') return resolve({ uploads: extra.files.map(function (f, i) { return Object.assign({ path: 'demo/' + i + '-' + f.name, token: 'demo' }, f); }) });
      if (action === 'submit') {
        var r = demo.submit(demoFamily, extra);
        if (r.error) return reject(new Error(r.error));
        try { new BroadcastChannel('roster-demo').postMessage({ type: 'submission', email: demo.email, submission: r.submission }); } catch (e) { }
        return resolve(demo.portalView(demoFamily));
      }
      reject(new Error('Not available in the practice camp.'));
    });
    return fetch(cfg.supabaseUrl + '/functions/v1/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey },
      body: JSON.stringify(Object.assign({ t: token, action: action }, extra || {}))
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); });
  }

  function chip(status) {
    if (status === 'approved') return '<span class="chip good">Done</span>';
    if (status === 'received') return '<span class="chip good">Received</span>';
    if (status === 'not_needed') return '<span class="chip good">Done</span>';
    if (status === 'rejected') return '<span class="chip bad">Please redo</span>';
    return '<span class="chip warn">To do</span>';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function key(r, camperId) { return r.id + ':' + (camperId || 'family'); }

  function render() {
    var d = state.data, all = [], html = '';
    d.family_requirements.forEach(function (r) { all.push(r.status); });
    d.campers.forEach(function (c) { c.requirements.forEach(function (r) { all.push(r.status); }); });
    var done = all.filter(function (s) { return DONE[s]; }).length;
    if (d.demo) html += '<div class="demonote" role="status"><strong>Practice family page in ' + esc(d.camp.name) + '.</strong> This is what a family sees. Try anything: forms you send here show up in the test camp, but nothing is saved, files aren\'t kept, and the SFSP button opens the SFSP app\'s practice form.</div>';
    html += '<div class="hello"><p class="muted small">' + esc(d.camp.name) + '</p><h1>' + esc(parentsOf(d)) + '</h1>';
    html += '<p>' + (done === all.length ? 'Everything is in. Thank you!' : 'Here is what the camp still needs' + (d.camp.deadline ? ', by <strong>' + esc(fmtDate(d.camp.deadline)) + '</strong>' : '') + '. You can do a little at a time; your progress is saved.') + '</p>';
    html += '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + all.length + '" aria-valuenow="' + done + '" aria-label="Forms completed"><i style="width:' + (all.length ? Math.round(done / all.length * 100) : 0) + '%"></i></div>';
    html += '<p class="small muted">' + done + ' of ' + all.length + ' done</p></div>';

    if (d.family_requirements.length) {
      html += '<section class="camper"><h2>For the whole family</h2>';
      d.family_requirements.forEach(function (r) { html += reqCard(r, null, ''); });
      html += '</section>';
    }
    d.campers.forEach(function (c) {
      html += '<section class="camper"><h2>' + esc(c.first_name + ' ' + c.last_name) + '</h2>';
      c.requirements.forEach(function (r) { html += reqCard(r, c, c.first_name); });
      html += '</section>';
    });
    if (done === all.length) html += '<div class="alldone"><h2>All done</h2><p>Thank you. Nothing else is needed right now.</p></div>';
    html += '<p class="small muted" style="margin-top:32px">Questions? ' + (d.camp.email ? 'Email <a href="mailto:' + esc(d.camp.email) + '">' + esc(d.camp.email) + '</a>' : 'Contact the camp office') + (d.camp.phone ? ' or call ' + esc(d.camp.phone) : '') + '. This page is private to your family; please don\'t share the link.</p>';
    app.innerHTML = html;
  }

  // "Parents of Chaim Aderet", "Parents of Chaim and Moshe Aderet", "Parents of Chaim, Moshe and Dovid Aderet".
  function parentsOf(d) {
    var kids = d.campers;
    if (!kids.length) return 'Parents of the ' + d.family.last_name + ' family';
    var list = function (a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
    var last = kids[0].last_name;
    var same = kids.every(function (c) { return c.last_name === last; });
    return 'Parents of ' + (same ? list(kids.map(function (c) { return c.first_name; })) + (last ? ' ' + last : '')
      : list(kids.map(function (c) { return (c.first_name + ' ' + c.last_name).trim(); })));
  }

  function reqCard(r, camper, who) {
    var k = key(r, camper && camper.id), isOpen = state.open === k, finished = DONE[r.status];
    var sub = r.help || '';
    var out = '<div class="req' + (isOpen ? ' open' : '') + (finished ? ' done' : '') + '" data-k="' + esc(k) + '">';
    out += '<button class="head" data-act="toggle" data-k="' + esc(k) + '" aria-expanded="' + isOpen + '"><span class="title">' + esc(r.label) + '<span class="sub">' + esc(sub) + '</span></span>' + chip(r.status) + '</button>';
    out += '<div class="body">' + (isOpen ? reqBody(r, camper, who) : '') + '</div></div>';
    return out;
  }

  function reqBody(r, camper, who) {
    var k = key(r, camper && camper.id), dr = state.drafts[k] || (state.drafts[k] = { files: [], answers: {} });
    var out = '';
    if (r.status === 'rejected' && r.reason) out += '<div class="reason"><strong>The camp asked for this again:</strong> ' + esc(r.reason) + '</div>';
    if (DONE[r.status] && r.kind !== 'sfsp') out += '<p class="muted small">We have this' + (r.status === 'approved' ? ' and it has been checked' : '') + '. If you need to send a newer one, you can do it below.</p>';
    if (r.kind === 'sfsp') {
      if (r.status === 'not_needed') return '<p>Your family doesn\'t need this form: it is only for campers 18 and under.</p>';
      if (DONE[r.status]) return '<p>We have your SFSP form. Thank you.</p>';
      return state.data.sfsp_link
        ? '<p>This form lets the camp claim free summer meals. It takes about 5 minutes and opens on the camp\'s meal-program site.' + (state.data.demo ? ' In the practice camp, it opens the SFSP app\'s practice form.' : '') + '</p><a class="btn primary" href="' + esc(state.data.sfsp_link) + '" target="_blank" rel="noopener">Fill in the SFSP form</a><p class="small muted">It will show as received here shortly after you send it.</p>'
        : '<p>The camp will send you the link to this form separately.</p>';
    }
    if (r.kind === 'upload') {
      (r.config.fields || []).forEach(function (f) {
        out += '<label class="field">' + esc(f.label) + (f.optional ? ' <span class="muted">(optional)</span>' : '') + '<input type="text" data-field="' + esc(f.key) + '" data-k="' + esc(k) + '" value="' + esc(dr.answers[f.key] || '') + '" autocomplete="off"></label>';
      });
      out += '<p class="small muted">Take a clear photo of each page, or attach a PDF.</p>';
      out += filesBlock(k, dr);
    } else if (r.kind === 'consent') {
      out += '<div class="consent-text">' + esc(r.config.text || '') + '</div>';
      out += '<label class="check"><input type="checkbox" data-agree data-k="' + esc(k) + '"' + (dr.answers.agree ? ' checked' : '') + '><span>I agree, as the parent or guardian.</span></label>';
      out += '<label class="field">Type your full name as your signature<input type="text" data-field="signed_name" data-k="' + esc(k) + '" value="' + esc(dr.answers.signed_name || '') + '" autocomplete="name"></label>';
    } else if (r.kind === 'questionnaire') {
      out += '<p>Does ' + esc(who) + ' have any allergies, medical conditions, or take any medications?</p>';
      out += '<div class="choice" role="radiogroup" aria-label="Allergies, conditions or medications">' +
        '<label><input type="radio" name="has-' + esc(k) + '" value="no" data-has data-k="' + esc(k) + '"' + (dr.answers.has_any === 'no' ? ' checked' : '') + '><span>No</span></label>' +
        '<label><input type="radio" name="has-' + esc(k) + '" value="yes" data-has data-k="' + esc(k) + '"' + (dr.answers.has_any === 'yes' ? ' checked' : '') + '><span>Yes</span></label></div>';
      if (dr.answers.has_any === 'yes') {
        [['allergies', 'Allergies (and what happens)'], ['conditions', 'Medical conditions'], ['medications', 'Medications, with dose and times'], ['diet', 'Dietary needs'], ['other', 'Anything else the nurse should know']].forEach(function (p) {
          out += '<label class="field">' + p[1] + '<textarea data-field="' + p[0] + '" data-k="' + esc(k) + '">' + esc(dr.answers[p[0]] || '') + '</textarea></label>';
        });
        out += '<label class="check"><input type="checkbox" data-flag="epipen" data-k="' + esc(k) + '"' + (dr.answers.epipen ? ' checked' : '') + '><span>Carries an EpiPen</span></label>';
        out += '<label class="check"><input type="checkbox" data-flag="inhaler" data-k="' + esc(k) + '"' + (dr.answers.inhaler ? ' checked' : '') + '><span>Uses an inhaler</span></label>';
        out += '<p class="small muted">You can also attach doctor\'s notes or an allergy action plan.</p>' + filesBlock(k, dr);
      }
    }
    out += '<div class="err-slot"></div><div class="row" style="margin-top:12px"><button class="primary" data-act="save" data-k="' + esc(k) + '" data-req="' + esc(r.id) + '" data-camper="' + esc(camper ? camper.id : '') + '"' + (dr.busy ? ' disabled' : '') + '>' + (dr.busy ? esc(dr.busy) : 'Send') + '</button></div>';
    return out;
  }

  function filesBlock(k, dr) {
    var out = '<div class="files">';
    dr.files.forEach(function (f, i) { out += '<span class="f">' + esc(f.name) + ' <button aria-label="Remove ' + esc(f.name) + '" data-act="rm" data-k="' + esc(k) + '" data-i="' + i + '">✕</button></span>'; });
    out += '</div><label class="btn"><input type="file" class="sr-only" accept="image/*,application/pdf" multiple data-files data-k="' + esc(k) + '">Add photo or file</label>';
    return out;
  }

  // Phone photos are often 4–8 MB; shrink JPEG/PNG/WebP to 2000 px so uploads are quick. Others go as they are.
  function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5e6) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function findReq(k) {
    var parts = k.split(':'), d = state.data;
    if (parts[1] === 'family') return { r: d.family_requirements.find(function (x) { return x.id === parts[0]; }), camper: null };
    var c = d.campers.find(function (x) { return x.id === parts[1]; });
    return { r: c && c.requirements.find(function (x) { return x.id === parts[0]; }), camper: c };
  }

  function showError(k, msg) {
    var slot = app.querySelector('.req[data-k="' + k + '"] .err-slot');
    if (slot) { slot.innerHTML = '<div class="error" role="alert">' + esc(msg) + '</div>'; }
  }

  function save(k, reqId, camperId) {
    var dr = state.drafts[k];
    var upload = Promise.resolve([]);
    var local = dr.files.filter(function (f) { return f.file; });
    dr.busy = local.length ? 'Uploading…' : 'Sending…'; render();
    if (local.length) {
      upload = call('upload-urls', { requirement_id: reqId, camper_id: camperId || null, files: local.map(function (f) { return { name: f.file.name, type: f.file.type, size: f.file.size }; }) })
        .then(function (res) {
          return Promise.all(res.uploads.map(function (u, i) {
            if (demo) return { path: u.path, name: u.name, type: u.type, size: u.size };   // practice camp: files aren't kept
            return sb.storage.from('forms').uploadToSignedUrl(u.path, u.token, local[i].file, { contentType: u.type }).then(function (r) {
              if (r.error) throw new Error('A file did not upload. Please try again.');
              return { path: u.path, name: u.name, type: u.type, size: u.size };
            });
          }));
        });
    }
    upload.then(function (files) {
      dr.busy = 'Sending…';
      return call('submit', { requirement_id: reqId, camper_id: camperId || null, files: files, answers: dr.answers });
    }).then(function (data) {
      state.data = data; delete state.drafts[k]; state.open = null; render();
    }).catch(function (e) {
      dr.busy = null; render(); showError(k, e.message);
    });
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var k = b.getAttribute('data-k');
    if (b.dataset.act === 'toggle') { state.open = state.open === k ? null : k; render(); var el = app.querySelector('.req[data-k="' + k + '"]'); if (el && state.open) el.scrollIntoView({ block: 'nearest' }); }
    if (b.dataset.act === 'rm') { state.drafts[k].files.splice(+b.dataset.i, 1); render(); }
    if (b.dataset.act === 'save') save(k, b.dataset.req, b.dataset.camper);
  });
  app.addEventListener('input', function (e) {
    var t = e.target, k = t.getAttribute('data-k'); if (!k || !state.drafts[k]) return;
    if (t.dataset.field) state.drafts[k].answers[t.dataset.field] = t.value;
  });
  app.addEventListener('change', function (e) {
    var t = e.target, k = t.getAttribute('data-k'); if (!k || !state.drafts[k]) return;
    var dr = state.drafts[k];
    if (t.hasAttribute('data-agree')) dr.answers.agree = t.checked;
    if (t.dataset.flag) dr.answers[t.dataset.flag] = t.checked;
    if (t.hasAttribute('data-has')) { dr.answers.has_any = t.value; render(); }
    if (t.hasAttribute('data-files')) {
      Promise.all([].slice.call(t.files).map(shrink)).then(function (fs) {
        fs.forEach(function (f) { dr.files.push({ name: f.name, file: f }); });
        render();
      });
    }
  });

  if (!token && !demo) { app.innerHTML = '<h1>Link not complete</h1><p>Please open the link from the camp\'s email again.</p>'; return; }
  call('view').then(function (d) { state.data = d; render(); })
    .catch(function (e) { app.innerHTML = '<h1>We couldn\'t open your forms</h1><p>' + esc(e.message) + '</p>'; });
})();
