// Online registration for parents: /register.html?camp=<slug>
// Parents sign in (Google pop-up or email + password, so it works in a home-screen app too), fill in one application
// for the family (saved as they type), sign and send it. The camp office then accepts, waitlists or declines it.
(function () {
  'use strict';
  var cfg = window.ROSTER_CONFIG || {};
  var $app = document.getElementById('app');
  var params = new URLSearchParams(location.search);
  var slug = params.get('camp') || cfg.campSlug;
  var KIND = 'camper';
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  var S = { info: null, user: null, app: null, saving: null };

  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var day = function (d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''; };
  var range = function (s) { return s.starts_on ? day(s.starts_on).replace(/, \d{4}$/, '') + (s.ends_on ? ' – ' + day(s.ends_on) : '') : ''; };
  function show(html) { $app.innerHTML = html; window.scrollTo(0, 0); }
  function oops(e) { console.error(e); var m = (e && e.message) || String(e); show('<div class="error">Something went wrong: ' + esc(m) + '</div><p><button onclick="location.reload()">Try again</button></p>'); }

  // ---------- Google pop-up returning here ----------
  if (params.get('popup') === '1' && window.opener) {
    sb.auth.getSession().then(function (r) {
      var s = r.data.session;
      if (s) { try { window.opener.postMessage({ type: 'roster-signed-in', access_token: s.access_token, refresh_token: s.refresh_token }, location.origin); } catch (e) { } }
      $app.innerHTML = '<p>Signed in. You can close this window.</p>'; window.close();
    });
    return;
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'roster-signed-in') return;
    sb.auth.setSession({ access_token: e.data.access_token, refresh_token: e.data.refresh_token }).then(function () { start(); }).catch(oops);
  });
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === 'PASSWORD_RECOVERY') { S.recovering = true; signIn(null, 'reset'); }
    else if (ev === 'SIGNED_IN' && !S.user && !S.recovering) start();
  });

  // ---------- Start ----------
  function start() {
    var err = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, '')).get('error_description');
    sb.rpc('registration_info', { p_slug: slug, p_kind: KIND }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data) return show('<h1>Camp not found</h1><p>Check the link you were given.</p>');
      S.info = r.data;
      document.getElementById('campName').textContent = S.info.name;
      document.title = 'Apply to ' + S.info.name;
      return sb.auth.getSession().then(function (x) {
        var s = x.data.session;
        if (err) { history.replaceState(null, '', location.pathname + '?camp=' + encodeURIComponent(slug)); return signIn('Sign-in didn\'t work: ' + err.replace(/\+/g, ' ') + '.'); }
        if (S.recovering) return signIn(null, 'reset');
        if (!s) return intro();
        S.user = s.user;
        return sb.from('applications').select('*').eq('camp_id', S.info.camp_id).eq('kind', KIND).eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(1).then(function (a) {
          if (a.error) throw a.error;
          S.app = a.data[0] || null;
          if (S.app && S.app.status !== 'draft') return status();
          if (!S.info.open) return closed();
          form();
        });
      });
    }).catch(oops);
  }

  function closed() {
    var i = S.info, why;
    if (!i.enabled) why = 'Online registration isn\'t open yet.';
    else if (i.opens_on && new Date(i.opens_on + 'T23:59:59') > new Date()) why = 'Registration opens on ' + day(i.opens_on) + '.';
    else why = 'Registration closed' + (i.closes_on ? ' on ' + day(i.closes_on) : '') + '.';
    show('<h1>' + esc(i.name) + '</h1><p>' + esc(why) + '</p>' + (i.contact ? '<p>Questions? Email <a href="mailto:' + esc(i.contact) + '">' + esc(i.contact) + '</a>.</p>' : '') +
      (S.user ? '<p class="small muted">Signed in as ' + esc(S.user.email) + ' · <a href="#" id="out">Sign out</a></p>' : ''));
    bindOut();
  }

  function intro() {
    if (!S.info.open) return closed();
    signIn(null, 'in', true);
  }

  // ---------- Sign in ----------
  function signIn(msg, mode, withIntro) {
    mode = mode || 'in';
    var i = S.info;
    show((withIntro ? '<h1>Apply to ' + esc(i.name) + '</h1>' + (i.intro ? '<p style="white-space:pre-line">' + esc(i.intro) + '</p>' : '') +
        '<p class="muted">Sign in or create an account so you can come back to your application.</p>' : '') +
      '<div class="card signin"><h2 style="margin-top:0">' + { in: 'Sign in', up: 'Create an account', forgot: 'Reset your password', reset: 'Choose a new password' }[mode] + '</h2>' +
      (msg ? '<div class="' + (/^✓/.test(msg) ? 'notice' : 'error') + '">' + esc(msg.replace(/^✓\s*/, '')) + '</div>' : '') +
      (mode === 'in' || mode === 'up' ? '<p><button class="primary" id="g" style="width:100%">Continue with Google</button></p><div class="or"><span>or</span></div>' : '') +
      '<form id="pw">' +
      (mode !== 'reset' ? '<label class="field">Email<input type="email" id="em" required autocomplete="email"></label>' : '') +
      (mode !== 'forgot' ? '<label class="field">' + (mode === 'reset' ? 'New password' : 'Password') + '<input type="password" id="pwd" required minlength="8" autocomplete="' + (mode === 'in' ? 'current-password' : 'new-password') + '"></label>' : '') +
      '<button class="primary" style="width:100%">' + { in: 'Sign in', up: 'Create account', forgot: 'Email me a reset link', reset: 'Save password' }[mode] + '</button></form>' +
      '<p class="small" style="text-align:center;margin-top:14px">' + (mode === 'in' ? '<a href="#" data-mode="up">Create an account</a> · <a href="#" data-mode="forgot">Forgot password?</a>' : mode === 'reset' ? '' : '<a href="#" data-mode="in">Back to sign in</a>') + '</p></div>');
    [].forEach.call($app.querySelectorAll('[data-mode]'), function (a) { a.onclick = function (e) { e.preventDefault(); signIn(null, a.dataset.mode, withIntro); }; });
    var g = document.getElementById('g');
    if (g) g.onclick = function () {
      sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/register.html?popup=1&camp=' + encodeURIComponent(slug), skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } }).then(function (r) {
        if (r.error) throw r.error;
        if (!window.open(r.data.url, 'roster-google', 'width=500,height=650')) location.href = r.data.url;
      }).catch(oops);
    };
    var here = location.origin + '/register.html?camp=' + encodeURIComponent(slug);
    document.getElementById('pw').onsubmit = function (e) {
      e.preventDefault();
      var em = document.getElementById('em'), pw = document.getElementById('pwd');
      var email = em && em.value.trim().toLowerCase(), pass = pw && pw.value;
      var again = function (m, md) { signIn(m, md || mode, withIntro); };
      var p = mode === 'in' ? sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
          if (r.error) return again(/confirm/i.test(r.error.message) ? 'Please confirm your email first: open the link we sent you, then sign in here.' : 'That email and password don\'t match. Try again, or use "Forgot password?".');
          start();
        })
        : mode === 'up' ? sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: here } }).then(function (r) {
          if (r.error) return again(r.error.message);
          if (r.data.session) return start();
          again('✓ Almost done: we emailed ' + email + ' a link to confirm the address. Open it, then sign in here.', 'in');
        })
        : mode === 'forgot' ? sb.auth.resetPasswordForEmail(email, { redirectTo: here }).then(function (r) {
          if (r.error) return again(r.error.message);
          again('✓ If ' + email + ' has an account, we emailed it a link to choose a new password.', 'in');
        })
        : sb.auth.updateUser({ password: pass }).then(function (r) { if (r.error) return again(r.error.message); S.recovering = false; start(); });
      p.catch(oops);
    };
  }
  function bindOut() {
    var o = document.getElementById('out');
    if (o) o.onclick = function (e) { e.preventDefault(); sb.auth.signOut().then(function () { S.user = null; S.app = null; start(); }); };
  }

  // ---------- The application (questions as the camp set them up: web/reg-form.js) ----------
  var F = function (key) { return window.RegForm.field(S.info.form, key); };
  var asks = function (key) { var f = F(key); return f && f.mode !== 'hidden'; };
  var plans = function () { return ((S.info.payment || {}).plans || []).filter(function (p) { return p && p.name; }); };
  function blankKid() { return { first: '', last: '', dob: '', gender: '', grade: '', hebrew_name: '', custom: {}, sessions: S.info.sessions.length === 1 ? [S.info.sessions[0].id] : [] }; }
  function data() {
    var d = (S.app && S.app.data) || {};
    d.father = d.father || {}; d.mother = d.mother || {}; d.custom = d.custom || {};
    d.emergency = d.emergency && d.emergency.length ? d.emergency : [{}, {}];
    d.campers = d.campers && d.campers.length ? d.campers : [blankKid()];
    if (!d.father.email && !d.mother.email && S.user) d.father.email = S.user.email;
    return d;
  }
  // A standard question, if the camp asks it. req: required (unless the camp made it optional); parent questions are checked together.
  var input = function (key, path, val, opts) {
    opts = opts || {};
    var f = F(key); if (!f || f.mode === 'hidden') return '';
    var optional = opts.forceOptional || f.mode === 'optional';
    return '<label class="field">' + esc(opts.label || f.label) + (optional && !opts.noMark ? ' <span class="small muted">(optional)</span>' : '') +
      '<input type="' + (opts.type || 'text') + '" data-k="' + path + '" value="' + esc(val || '') + '"' + (opts.auto ? ' autocomplete="' + opts.auto + '"' : '') +
      (optional || opts.parent ? '' : ' data-req') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') + ' maxlength="' + (opts.max || 120) + '"></label>';
  };
  // A camp's own question. path: where the answer goes ("custom.<id>" or "campers.<n>.custom.<id>").
  function question(q, path, val) {
    var req = q.required ? ' data-req' : '', lab = '<span>' + esc(q.label) + (q.required ? '' : ' <span class="small muted">(optional)</span>') + '</span>' + (q.help ? '<span class="small muted" style="display:block;font-weight:400">' + esc(q.help) + '</span>' : '');
    var opts = (q.options || []).filter(Boolean);
    if (q.type === 'multi') {
      var have = Array.isArray(val) ? val : [];
      return '<div class="field" style="font-weight:700">' + lab + '</div><div class="sessions" data-multi="' + path + '"' + (q.required ? ' data-multireq="' + esc(q.label) + '"' : '') + '>' + opts.map(function (o) {
        return '<label class="check"><input type="checkbox" value="' + esc(o) + '"' + (have.indexOf(o) >= 0 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>'; }).join('') + '</div>';
    }
    var ctl;
    if (q.type === 'long') ctl = '<textarea data-k="' + path + '"' + req + ' rows="3" maxlength="2000">' + esc(val || '') + '</textarea>';
    else if (q.type === 'yesno' || q.type === 'choice') ctl = '<select data-k="' + path + '"' + req + '><option value="">Choose…</option>' + (q.type === 'yesno' ? ['Yes', 'No'] : opts).map(function (o) { return '<option' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    else ctl = '<input type="' + (q.type === 'date' ? 'date' : 'text') + '"' + (q.type === 'number' ? ' inputmode="decimal"' : '') + ' data-k="' + path + '"' + req + ' value="' + esc(val || '') + '" maxlength="500">';
    return '<label class="field">' + lab + ctl + '</label>';
  }
  var customs = function (section, base, vals) { return window.RegForm.custom(S.info.form, section).map(function (q) { return question(q, base + q.id, (vals || {})[q.id]); }).join(''); };
  function parent(who, p, label) {
    return '<fieldset class="sec"><legend>' + label + '</legend><div class="row2">' +
      input('parent.first', who + '.first', p.first, { auto: 'given-name', parent: true, noMark: true }) +
      (who === 'mother' ? input('parent.maiden', 'mother.maiden', p.maiden, { label: 'Maiden name' }) : input('parent.title', 'father.title', p.title, { max: 20 })) +
      input('parent.phone', who + '.phone', p.phone, { type: 'tel', auto: 'tel', inputmode: 'tel', max: 40, parent: true, noMark: true }) +
      input('parent.email', who + '.email', p.email, { type: 'email', auto: 'email', max: 160, parent: true, noMark: true }) +
      input('parent.occupation', who + '.occupation', p.occupation) + '</div></fieldset>';
  }
  function kid(k, n) {
    var sess = S.info.sessions, g = F('camper.grade');
    var sel = function (key, inner) { var f = F(key); if (!f || f.mode === 'hidden') return ''; return '<label class="field">' + esc(f.label) + (f.mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '<select data-k="campers.' + n + '.' + key.split('.')[1] + '"' + (f.mode === 'required' ? ' data-req' : '') + '><option value="">Choose…</option>' + inner + '</select></label>'; };
    return '<div class="kid" data-kid="' + n + '"><div class="kidhead"><h3 style="margin:6px 0">Camper ' + (n + 1) + '</h3>' + (n ? '<button type="button" data-remove="' + n + '">Remove</button>' : '') + '</div><div class="row2">' +
      input('camper.first', 'campers.' + n + '.first', k.first) + input('camper.last', 'campers.' + n + '.last', k.last) +
      input('camper.dob', 'campers.' + n + '.dob', k.dob, { type: 'date' }) +
      sel('camper.grade', (g ? g.options : []).map(function (x) { return '<option' + (k.grade === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('')) +
      sel('camper.gender', '<option value="Male"' + (k.gender === 'Male' ? ' selected' : '') + '>Boy</option><option value="Female"' + (k.gender === 'Female' ? ' selected' : '') + '>Girl</option>') +
      input('camper.hebrew_name', 'campers.' + n + '.hebrew_name', k.hebrew_name) + '</div>' +
      (sess.length && asks('camper.sessions') ? '<div class="field" style="font-weight:700">' + esc(F('camper.sessions').label) + (F('camper.sessions').mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '</div><div class="sessions" data-sessions="' + n + '">' + sess.map(function (x) {
        return '<label class="check"><input type="checkbox" value="' + esc(x.id) + '"' + ((k.sessions || []).indexOf(x.id) >= 0 ? ' checked' : '') + '><span>' + esc(x.name) + (range(x) ? ' <span class="muted small">' + esc(range(x)) + '</span>' : '') + '</span></label>';
      }).join('') + '</div>' : '') + customs('camper', 'campers.' + n + '.custom.', k.custom) + '</div>';
  }
  function form(msg) {
    var d = data(), i = S.info, pl = plans();
    var famInner = input('last_name', 'last_name', d.last_name, { auto: 'family-name' }) + input('address', 'address', d.address, { auto: 'street-address', max: 160 }) +
      '<div class="row2">' + input('city', 'city', d.city, { auto: 'address-level2' }) + input('state', 'state', d.state, { auto: 'address-level1', max: 40 }) +
      input('zip', 'zip', d.zip, { auto: 'postal-code', inputmode: 'numeric', max: 10 }) + '</div>' + customs('family', 'custom.', d.custom);
    var emerg = asks('emergency') ? '<fieldset class="sec"><legend>Emergency contacts</legend><p class="small muted" style="margin:4px 0 0">Someone other than the parents, in case we can\'t reach you.</p>' + d.emergency.map(function (e, n) {
        var opt = n > 0 || F('emergency').mode === 'optional';
        return '<div class="row2" style="margin-top:8px">' + input('emergency', 'emergency.' + n + '.name', e.name, { label: 'Name', forceOptional: opt }) + input('emergency', 'emergency.' + n + '.phone', e.phone, { label: 'Phone', type: 'tel', inputmode: 'tel', forceOptional: opt, max: 40 }) +
          input('emergency.relation', 'emergency.' + n + '.relation', e.relation, { max: 60 }) + '</div>';
      }).join('') + customs('emergency', 'custom.', d.custom) + '</fieldset>' : '';
    var other = (asks('notes') ? '<label class="field">' + esc(F('notes').label) + (F('notes').mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '<textarea data-k="notes" maxlength="2000" rows="3"' + (F('notes').mode === 'required' ? ' data-req' : '') + '>' + esc(d.notes || '') + '</textarea></label>' : '') + customs('other', 'custom.', d.custom);
    show('<h1>Apply to ' + esc(i.name) + '</h1>' + (i.intro ? '<p style="white-space:pre-line">' + esc(i.intro) + '</p>' : '') +
      '<p class="small muted">Signed in as ' + esc(S.user.email) + ' · <a href="#" id="out">Sign out</a> · <span class="saved" id="saved">Your answers are saved as you go.</span></p>' +
      (msg ? '<div class="error">' + esc(msg) + '</div>' : '') +
      '<form id="appf" novalidate>' +
      '<fieldset class="sec"><legend>Family</legend>' + famInner + '</fieldset>' +
      parent('father', d.father, 'Father') + parent('mother', d.mother, 'Mother') +
      '<p class="small muted" style="margin-top:-8px">Fill in at least one parent; leave the other blank if it doesn\'t apply.</p>' +
      window.RegForm.custom(S.info.form, 'parents').map(function (q) { return question(q, 'custom.' + q.id, d.custom[q.id]); }).join('') +
      emerg +
      '<fieldset class="sec"><legend>Campers</legend>' + d.campers.map(kid).join('') + '<p><button type="button" id="addkid">+ Add another camper</button></p></fieldset>' +
      (other ? '<fieldset class="sec"><legend>Anything else?</legend>' + other + '</fieldset>' : '') +
      (pl.length ? '<fieldset class="sec"><legend>Payment plan</legend><div class="sessions" data-plan>' + pl.map(function (p) {
        return '<label class="check" style="align-items:flex-start"><input type="radio" name="plan" value="' + esc(p.id) + '"' + (d.payment_plan === p.id ? ' checked' : '') + '><span><strong>' + esc(p.name) + '</strong>' + (p.description ? '<span class="small muted" style="display:block;font-weight:400;white-space:pre-line">' + esc(p.description) + '</span>' : '') + '</span></label>';
      }).join('') + '</div></fieldset>' : '') +
      '<fieldset class="sec"><legend>Agreement</legend>' + (i.agreement ? '<div class="consent-text agree">' + esc(i.agreement) + '</div>' : '') +
      '<label class="check" style="margin-top:12px"><input type="checkbox" id="agree"><span>' + (i.agreement ? 'I have read and agree to the above.' : 'The information in this application is correct.') + '</span></label>' +
      '<label class="field">Type your full name to sign<input type="text" id="sig" maxlength="200" autocomplete="name" value="' + esc((S.app && S.app.signature) || '') + '"></label></fieldset>' +
      '<p><button class="primary" style="width:100%">Send application</button></p></form>');
    bindOut();
    var f = document.getElementById('appf');
    f.addEventListener('input', function () { save(); });
    f.addEventListener('change', function () { save(); });
    document.getElementById('addkid').onclick = function () { var d2 = collect(); d2.campers.push(blankKid()); S.app = Object.assign(S.app || {}, { data: d2 }); form(); save(); var k = $app.querySelectorAll('.kid'); k[k.length - 1].scrollIntoView(); };
    [].forEach.call($app.querySelectorAll('[data-remove]'), function (b) {
      b.onclick = function () { var d2 = collect(); d2.campers.splice(+b.dataset.remove, 1); S.app = Object.assign(S.app || {}, { data: d2 }); form(); save(); };
    });
    f.onsubmit = function (e) { e.preventDefault(); submit(); };
  }
  function setPath(d, pathStr, v) {
    var path = pathStr.split('.'), o = d;
    for (var n = 0; n < path.length - 1; n++) { var key = /^\d+$/.test(path[n]) ? +path[n] : path[n]; if (o[key] == null) o[key] = /^\d+$/.test(path[n + 1]) ? [] : {}; o = o[key]; }
    o[path[path.length - 1]] = v;
  }
  function collect() {
    var d = { father: {}, mother: {}, emergency: [], campers: [], custom: {} };
    [].forEach.call($app.querySelectorAll('[data-k]'), function (el) { setPath(d, el.dataset.k, el.value.trim()); });
    [].forEach.call($app.querySelectorAll('[data-multi]'), function (box) { setPath(d, box.dataset.multi, [].filter.call(box.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; })); });
    [].forEach.call($app.querySelectorAll('.kid'), function (el) { var n = +el.dataset.kid; d.campers[n] = d.campers[n] || {}; d.campers[n].custom = d.campers[n].custom || {}; });
    [].forEach.call($app.querySelectorAll('[data-sessions]'), function (box) {
      var n = +box.dataset.sessions; d.campers[n] = d.campers[n] || {};
      d.campers[n].sessions = [].filter.call(box.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; });
    });
    var pick = $app.querySelector('[data-plan] input:checked');
    if (pick) { var pl = plans().find(function (p) { return p.id === pick.value; }); d.payment_plan = pick.value; d.payment_plan_name = pl ? pl.name : ''; }
    d.campers = d.campers.filter(Boolean); d.emergency = d.emergency.filter(Boolean);
    return d;
  }
  // Save the draft a moment after typing stops.
  function save(now) {
    clearTimeout(S.saving);
    var run = function () {
      var d = collect(), el = document.getElementById('saved'), sig = document.getElementById('sig');
      var row = { data: d, signature: sig && sig.value.trim() || null };
      var q = S.app && S.app.id ? sb.from('applications').update(row).eq('id', S.app.id).select().single()
        : sb.from('applications').insert(Object.assign({ camp_id: S.info.camp_id, kind: KIND }, row)).select().single();
      return q.then(function (r) {
        if (r.error) throw r.error;
        S.app = r.data; if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.';
      }, function (e) { if (el) el.textContent = 'Not saved yet: ' + (e.message || e); throw e; });
    };
    if (now) return run();
    if (document.getElementById('saved')) document.getElementById('saved').textContent = 'Saving…';
    S.saving = setTimeout(function () { run().catch(function () { }); }, 800);
  }
  var labelOf = function (el) { var l = el.closest('label'); var t = l ? (l.querySelector('span') || l.firstChild).textContent : ''; return String(t).replace(/\(optional\)/, '').trim(); };
  function problems(d) {
    var out = [];
    [].forEach.call($app.querySelectorAll('.bad-field'), function (x) { x.classList.remove('bad-field'); });
    var mark = function (el) { if (el) el.classList.add('bad-field'); };
    [].forEach.call($app.querySelectorAll('[data-req]'), function (el) {
      if (el.value.trim()) return;
      mark(el);
      var kidEl = el.closest('.kid');
      out.push((kidEl ? 'camper ' + (+kidEl.dataset.kid + 1) + '\'s ' : /^emergency/.test(el.dataset.k || '') ? 'an emergency contact\'s ' : '') + labelOf(el).toLowerCase());
    });
    [].forEach.call($app.querySelectorAll('[data-multireq]'), function (box) {
      if (!box.querySelector('input:checked')) { var kidEl = box.closest('.kid'); out.push((kidEl ? 'camper ' + (+kidEl.dataset.kid + 1) + '\'s ' : '') + box.dataset.multireq.toLowerCase()); }
    });
    // At least one parent with every parent question the camp requires.
    var need = ['first', 'email'].concat(F('parent.phone').mode === 'required' ? ['phone'] : []);
    var full = function (w) { return need.every(function (k) { return d[w][k]; }); };
    if (!full('father') && !full('mother')) {
      var w = d.mother.first && !d.father.first ? 'mother' : 'father';
      out.push('at least one parent\'s ' + need.map(function (k) { return { first: 'first name', email: 'email', phone: 'cell phone' }[k]; }).join(', '));
      need.forEach(function (k) { if (!d[w][k]) mark($app.querySelector('[data-k="' + w + '.' + k + '"]')); });
    }
    ['father', 'mother'].forEach(function (w) { if (d[w].email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d[w].email)) { out.push('a valid ' + w + '\'s email'); mark($app.querySelector('[data-k="' + w + '.email"]')); } });
    if (S.info.sessions.length && asks('camper.sessions') && F('camper.sessions').mode === 'required') d.campers.forEach(function (k, n) { if (!(k.sessions || []).length) out.push('camper ' + (n + 1) + '\'s sessions'); });
    if (plans().length && !d.payment_plan) out.push('a payment plan');
    if (!document.getElementById('agree').checked) out.push('the agreement checkbox');
    if (!document.getElementById('sig').value.trim()) { out.push('your signature'); mark(document.getElementById('sig')); }
    return out;
  }
  function submit() {
    var d = collect(), p = problems(d);
    var old = document.querySelector('.formerr'); if (old) old.remove();
    if (p.length) {
      var div = document.createElement('div'); div.className = 'error formerr'; div.textContent = 'Please fill in ' + p.join('; ') + '.';
      var btn = document.querySelector('#appf button.primary'); btn.parentNode.insertBefore(div, btn);
      var first = $app.querySelector('.bad-field'); if (first) first.focus();
      return;
    }
    clearTimeout(S.saving);
    var btn2 = document.querySelector('#appf button.primary'); btn2.disabled = true; btn2.textContent = 'Sending…';
    save(true).then(function () {
      return sb.from('applications').update({ status: 'submitted' }).eq('id', S.app.id).select().single();
    }).then(function (r) {
      if (r.error) throw r.error;
      // Read it back: camps that don't review applications accept them straight away.
      var sent = Object.assign({}, S.app, r.data);
      return sb.from('applications').select('*').eq('id', S.app.id).maybeSingle().then(function (x) { S.app = Object.assign(sent, (x && x.data) || {}); });
    }).then(function () {
      // Confirmation email (sent once; the application is already saved if this fails).
      sb.auth.getSession().then(function (x) {
        return fetch(cfg.supabaseUrl + '/functions/v1/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + x.data.session.access_token, apikey: cfg.supabaseAnonKey }, body: JSON.stringify({ action: 'application_submitted', id: S.app.id }) });
      }).catch(function () { });
      status();
    }).catch(function (e) { btn2.disabled = false; btn2.textContent = 'Send application'; form(e.message || String(e)); });
  }

  // ---------- After sending ----------
  function status() {
    var a = S.app, d = a.data || {}, i = S.info, pay = i.payment || {};
    var head = {
      submitted: ['We received your application', 'The camp office will review it and email ' + esc(a.email) + '.'],
      waitlisted: ['You\'re on the waiting list', 'We\'ll email ' + esc(a.email) + ' if a place opens up.'],
      accepted: ['Accepted!', 'Welcome to ' + esc(i.name) + '. Watch for an email with your family\'s forms.'],
      declined: ['We\'re not able to offer a place', 'We\'re sorry we couldn\'t offer a place this time.'],
      withdrawn: ['Application withdrawn', '']
    }[a.status] || ['Application', ''];
    var sess = {}; i.sessions.forEach(function (x) { sess[x.id] = x.name; });
    var plan = plans().find(function (p) { return p.id === d.payment_plan; });
    var payNow = plan && (a.status === 'accepted' || (pay.show === 'after_send' && (a.status === 'submitted' || a.status === 'waitlisted')));
    show('<h1>' + esc(i.name) + '</h1><div class="status"><h2 style="margin:0 0 6px">' + head[0] + '</h2><p style="margin:0">' + head[1] + '</p></div>' +
      (payNow ? '<div class="card" style="margin-top:16px"><h2 style="margin-top:0">Payment: ' + esc(plan.name) + '</h2>' + (plan.description ? '<p style="white-space:pre-line">' + esc(plan.description) + '</p>' : '') +
        (plan.link ? '<p><a class="btn primary" href="' + esc(plan.link) + '" target="_blank" rel="noopener">Pay now</a></p><p class="small muted">Payments are made through ' + esc(i.name) + '\'s payment page.</p>' : '') + '</div>' : '') +
      '<h2 style="margin-top:26px">Your application</h2><dl class="sum">' +
      '<dt>Family</dt><dd>' + esc(d.last_name) + (d.address ? ', ' + esc([d.address, d.city, d.state, d.zip].filter(Boolean).join(', ')) : '') + '</dd>' +
      ['father', 'mother'].filter(function (w) { return d[w] && d[w].first; }).map(function (w) { return '<dt>' + (w === 'father' ? 'Father' : 'Mother') + '</dt><dd>' + esc([d[w].first, d[w].phone, d[w].email].filter(Boolean).join(' · ')) + '</dd>'; }).join('') +
      '<dt>Campers</dt>' + (d.campers || []).map(function (k) { return '<dd>' + esc(k.first + ' ' + (k.last || d.last_name || '')) + (k.grade ? ', ' + esc(k.grade) : '') + ((k.sessions || []).length ? ' · ' + esc(k.sessions.map(function (x) { return sess[x] || ''; }).filter(Boolean).join(' & ')) : '') + '</dd>'; }).join('') +
      (plan ? '<dt>Payment plan</dt><dd>' + esc(plan.name) + '</dd>' : '') +
      '<dt>Sent</dt><dd>' + esc(a.submitted_at ? new Date(a.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '') + ' · signed by ' + esc(a.signature || '') + '</dd></dl>' +
      (i.contact ? '<p>Need to change something? Email <a href="mailto:' + esc(i.contact) + '">' + esc(i.contact) + '</a>.</p>' : '') +
      '<p class="small muted">Signed in as ' + esc(S.user.email) + ' · <a href="#" id="out">Sign out</a></p>');
    bindOut();
  }

  start();
})();
