// Online registration for parents: /register.html?camp=<slug>
// Parents sign in (Google pop-up or email + password, so it works in a home-screen app too), fill in one application
// for the family (saved as they type), sign and send it. The camp office then accepts, waitlists or declines it.
(function () {
  'use strict';
  var cfg = window.ROSTER_CONFIG || {};
  var $app = document.getElementById('app');
  var params = new URLSearchParams(location.search);
  var slug = params.get('camp') || cfg.campSlug;
  var KIND = params.get('kind') === 'staff' ? 'staff' : 'camper';
  // A session's own link (?session=<name as a slug>): only that session is offered.
  var SESSION = params.get('session') || '';
  var slugOf = function (n) { return String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
  // This page's address (for sign-in links), without sign-in leftovers.
  var selfUrl = function (extra) { return location.origin + '/register.html?camp=' + encodeURIComponent(slug) + (KIND === 'staff' ? '&kind=staff' : '') + (SESSION ? '&session=' + encodeURIComponent(SESSION) : '') + (extra || ''); };
  var STAFF = KIND === 'staff';
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
      if (SESSION) {
        var only = S.info.sessions.find(function (x) { return slugOf(x.name) === SESSION || x.id === SESSION; });
        // A session that isn't offered online (or a mistyped link) is closed.
        if (!only) S.info.open = false;
        S.info.sessions = only ? [only] : [];
        S.info.sessionName = only ? only.name : '';
      }
      document.getElementById('campName').textContent = S.info.name + (S.info.sessionName ? ' · ' + S.info.sessionName : '');
      document.title = (STAFF ? 'Work at ' : 'Apply to ') + S.info.name;
      return sb.auth.getSession().then(function (x) {
        var s = x.data.session;
        if (err) { history.replaceState(null, '', selfUrl().replace(location.origin, '')); return signIn('Sign-in didn\'t work: ' + err.replace(/\+/g, ' ') + '.'); }
        if (S.recovering) return signIn(null, 'reset');
        if (!s) return intro();
        S.user = s.user;
        return sb.from('applications').select('*').eq('camp_id', S.info.camp_id).eq('kind', KIND).eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(1).then(function (a) {
          if (a.error) throw a.error;
          S.app = a.data[0] || null;
          if (S.app && S.app.status !== 'draft') return STAFF ? staffStatus() : status();
          if (!S.info.open) return closed();
          STAFF ? staffForm() : form();
        });
      });
    }).catch(oops);
  }

  function closed() {
    var i = S.info, why;
    if (SESSION && !i.sessionName) why = 'Online registration for this session isn\'t open. Check the link you were given.';
    else if (!i.enabled) why = 'Online registration isn\'t open yet.';
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
    show((withIntro ? '<h1>' + (STAFF ? 'Apply to work at ' : 'Apply to ') + esc(i.name) + (i.sessionName ? ': ' + esc(i.sessionName) : '') + '</h1>' + (i.intro ? '<p style="white-space:pre-line">' + esc(i.intro) + '</p>' : '') +
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
      sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: selfUrl('&popup=1'), skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } }).then(function (r) {
        if (r.error) throw r.error;
        if (!window.open(r.data.url, 'roster-google', 'width=500,height=650')) location.href = r.data.url;
      }).catch(oops);
    };
    var here = selfUrl();
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
  var F = function (key) { return window.RegForm.field(S.info.form, key, KIND); };
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
    show('<h1>Apply to ' + esc(i.name) + (i.sessionName ? ': ' + esc(i.sessionName) : '') + '</h1>' + (i.intro ? '<p style="white-space:pre-line">' + esc(i.intro) + '</p>' : '') +
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
      '<p><button class="primary" id="sendapp" style="width:100%">Send application</button></p></form>');
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
    var d = STAFF ? { father: {}, mother: {}, emergency: [], camper_experience: [], staff_experience: [], custom: {} } : { father: {}, mother: {}, emergency: [], campers: [], custom: {} };
    [].forEach.call($app.querySelectorAll('[data-k]'), function (el) { setPath(d, el.dataset.k, el.value.trim()); });
    [].forEach.call($app.querySelectorAll('[data-multi]'), function (box) { setPath(d, box.dataset.multi, [].filter.call(box.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; })); });
    [].forEach.call($app.querySelectorAll('.kid'), function (el) { var n = +el.dataset.kid; d.campers[n] = d.campers[n] || {}; d.campers[n].custom = d.campers[n].custom || {}; });
    [].forEach.call($app.querySelectorAll('[data-sessions]'), function (box) {
      var n = +box.dataset.sessions; d.campers[n] = d.campers[n] || {};
      d.campers[n].sessions = [].filter.call(box.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; });
    });
    [].forEach.call($app.querySelectorAll('[data-none]'), function (x) { d[x.dataset.none] = x.checked; });
    var pick = $app.querySelector('[data-plan] input:checked');
    if (pick) { var pl = plans().find(function (p) { return p.id === pick.value; }); d.payment_plan = pick.value; d.payment_plan_name = pl ? pl.name : ''; }
    if (STAFF) {
      if (S.app && S.app.data && S.app.data.tax_form) d.tax_form = S.app.data.tax_form;
      d.camper_experience = d.camper_experience.filter(Boolean); d.staff_experience = d.staff_experience.filter(Boolean);
      var sb2 = $app.querySelector('[data-staffsessions]'); d.sessions = sb2 ? [].filter.call(sb2.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; }) : [];
      var pb = $app.querySelector('[data-positions]'); d.positions = pb ? [].filter.call(pb.querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; }) : [];
      delete d.campers;
    } else d.campers = d.campers.filter(Boolean);
    d.emergency = d.emergency.filter(Boolean);
    if (S.info.sessionName) { d.applied_for = S.info.sessions[0].id; d.applied_for_name = S.info.sessionName; }
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
    if (STAFF) return out.concat(staffProblems(d, mark));
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
      var btn = document.getElementById('sendapp'); btn.parentNode.insertBefore(div, btn);
      var first = $app.querySelector('.bad-field'); if (first) first.focus();
      return;
    }
    clearTimeout(S.saving);
    var btn2 = document.getElementById('sendapp'); btn2.disabled = true; btn2.textContent = 'Sending…';
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
      STAFF ? staffStatus() : status();
    }).catch(function (e) { btn2.disabled = false; btn2.textContent = 'Send application'; (STAFF ? staffForm : form)(e.message || String(e)); });
  }



  // ---------- Tax form (W-4 / W-9): the filled-in IRS form, uploaded as a file ----------
  var IRS = { 'W-4': 'https://www.irs.gov/pub/irs-pdf/fw4.pdf', 'W-9': 'https://www.irs.gov/pub/irs-pdf/fw9.pdf' };
  function taxTypes() { return { w4: ['W-4'], w9: ['W-9'], choice: ['W-4', 'W-9'] }[S.info.tax_form] || []; }
  // The tax form: answer a few questions and the app fills in and signs the official IRS form (in this browser;
  // the SSN goes only into the PDF), or upload one already filled in.
  function taxSection(d) {
    var t = (d && d.tax_form) || {}, types = taxTypes(), chosen = t.type || (types.length === 1 ? types[0] : (S.taxType || ''));
    var appd = (S.app && S.app.data) || d || {};
    var q = function (id, label, val, extra) { return '<label class="field">' + label + '<input type="text" id="' + id + '" value="' + esc(val || '') + '" autocomplete="off"' + (extra || '') + '></label>'; };
    var ssn = '<div class="row2">' + q('tx_ssn', 'Social Security number', '', ' inputmode="numeric" maxlength="11" placeholder="123-45-6789" spellcheck="false"') + q('tx_ssn2', 'Type it again', '', ' inputmode="numeric" maxlength="11" spellcheck="false"') + '</div>';
    var addr = q('tx_addr', 'Street address', appd.address) + q('tx_csz', 'City, state and ZIP code', [appd.city, [appd.state, appd.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '));
    var w4 = '<div class="row2">' + q('tx_first', 'First name', appd.first) + q('tx_mi', 'Middle initial <span class="small muted">(optional)</span>', '', ' maxlength="1"') + '</div>' + q('tx_last', 'Last name', appd.last) +
      '<p class="small muted" style="margin-top:-4px">Exactly as on your Social Security card.</p>' + ssn + addr +
      '<div class="field" style="font-weight:700">Filing status</div><div class="sessions">' +
      [['single', 'Single <span class="small muted">(most students)</span>, or married filing separately'], ['joint', 'Married filing jointly, or qualifying surviving spouse'], ['head', 'Head of household <span class="small muted">(unmarried and paying more than half the costs of a home for yourself and a qualifying person)</span>']].map(function (o, n) {
        return '<label class="check"><input type="radio" name="tx_status" value="' + o[0] + '"' + (n === 0 ? ' checked' : '') + '><span>' + o[1] + '</span></label>'; }).join('') + '</div>' +
      '<label class="check" style="margin-top:10px;align-items:flex-start"><input type="checkbox" id="tx_exempt"><span><strong>Exempt from withholding</strong><span class="small muted" style="display:block;font-weight:400">Only if you owed no federal income tax last year <em>and</em> expect to owe none this year (often true for students whose only income is summer pay). Not sure? Leave this unticked or ask a parent.</span></span></label>' +
      '<div id="tx_more">' +
      '<label class="check" style="align-items:flex-start"><input type="checkbox" id="tx_two"><span>I have exactly one other job at the same time <span class="small muted" style="display:block">(ticks Step 2(c); tick it on the W-4 for the other job too. More jobs than that: use the IRS estimator at irs.gov/W4App and enter extra withholding below.)</span></span></label>' +
      '<details class="small" style="margin:8px 0"><summary>Dependents and other adjustments <span class="muted">(most students skip this)</span></summary>' +
      '<p class="muted">Only if your total income will be $200,000 or less ($400,000 married filing jointly).</p><div class="row2">' + q('tx_kids', 'Qualifying children under 17', '', ' inputmode="numeric" maxlength="2"') + q('tx_deps', 'Other dependents', '', ' inputmode="numeric" maxlength="2"') + '</div>' +
      '<div class="row2">' + q('tx_oinc', 'Other income, not from jobs ($ per year)', '', ' inputmode="decimal"') + q('tx_ded', 'Deductions beyond the standard ($ per year)', '', ' inputmode="decimal"') + q('tx_extra', 'Extra withholding ($ each pay period)', '', ' inputmode="decimal"') + '</div></details></div>' +
      '<label class="check" style="align-items:flex-start"><input type="checkbox" id="tx_perjury"><span>Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete.</span></label>';
    var w9 = q('tx_name', 'Your name, as shown on your income tax return', [appd.first, appd.last].filter(Boolean).join(' ')) + q('tx_biz', 'Business name <span class="small muted">(only if you have one)</span>', '') +
      '<p class="small muted">Tax classification: Individual / sole proprietor.</p>' + ssn + addr +
      '<label class="check" style="align-items:flex-start"><input type="checkbox" id="tx_perjury"><span>Under penalties of perjury, I certify that: (1) the number shown is my correct taxpayer identification number; (2) I am not subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; and (4) any FATCA code entered is correct. <span class="small muted">If the IRS has told you that you\'re subject to backup withholding, don\'t sign here; contact the camp office.</span></span></label>';
    return '<fieldset class="sec" id="taxsec"><legend>Tax form</legend>' +
      (types.length > 1 ? '<p style="margin-top:4px">Which form? <span class="small muted">If you\'re not sure, ask the camp office.</span></p><div class="sessions">' +
        '<label class="check"><input type="radio" name="taxtype" value="W-4"' + (chosen === 'W-4' ? ' checked' : '') + '><span><strong>W-4</strong> <span class="small muted">I\'ll be an employee</span></span></label>' +
        '<label class="check"><input type="radio" name="taxtype" value="W-9"' + (chosen === 'W-9' ? ' checked' : '') + '><span><strong>W-9</strong> <span class="small muted">I\'ll be paid as an independent contractor</span></span></label></div>' : '') +
      (t.path ? '<p><span class="chip good">Done</span> ' + esc(t.type) + ' ' + (t.filled ? 'filled in and signed' : 'uploaded') + (t.name && !t.filled ? ': ' + esc(t.name) : '') + '. <a href="#" id="taxredo">Do it again</a></p>' : '') +
      (chosen && !t.path ? '<div id="taxq"><p class="small">Answer these and we\'ll fill in and sign the official IRS Form ' + chosen + ' for you.</p>' + (chosen === 'W-4' ? w4 : w9) +
        '<label class="field">Type your full name to sign<input type="text" id="tx_sig" autocomplete="name" maxlength="120"></label><p class="small muted" style="margin-top:-6px">Date: ' + esc(new Date().toLocaleDateString('en-US')) + '</p>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" id="taxpreview">Preview the form</button><button type="button" class="primary" id="taxsign">Sign and save my ' + chosen + '</button></div></div>' : '') +
      (chosen && !t.path ? '<details class="small" style="margin-top:12px"><summary>Or upload a form you already filled in</summary><p>Download <a href="/irs/' + (chosen === 'W-4' ? 'fw4' : 'fw9') + '.pdf" target="_blank" rel="noopener">Form ' + chosen + '</a>, fill it in and sign it, then upload it as a PDF or a clear photo.</p><label class="field">Upload your ' + chosen + '<input type="file" id="taxfile" accept="application/pdf,image/*"></label></details>' : '') +
      '<p class="small muted">Your form includes your Social Security number. Only the camp\'s directors and the people they allow can open it, and the number isn\'t stored anywhere else.</p></fieldset>';
  }
  // Read the questionnaire; returns { answers } or { problem }.
  function taxAnswers(type) {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var ssn = v('tx_ssn'), a = { ssn: ssn, address: v('tx_addr'), cityStateZip: v('tx_csz'), signature: v('tx_sig'), email: S.user.email };
    if (!window.TaxFill.validSsn(ssn)) return { problem: 'Check your Social Security number (9 digits).' };
    if (window.TaxFill.ssnDigits(ssn) !== window.TaxFill.ssnDigits(v('tx_ssn2'))) return { problem: 'The two Social Security numbers don\'t match.' };
    if (!a.address || !a.cityStateZip) return { problem: 'Fill in your address.' };
    if (type === 'W-4') {
      a.first = v('tx_first'); a.middle = v('tx_mi'); a.last = v('tx_last');
      if (!a.first || !a.last) return { problem: 'Fill in your first and last name.' };
      var st = $app.querySelector('[name="tx_status"]:checked'); a.status = st ? st.value : 'single';
      a.exempt = document.getElementById('tx_exempt').checked;
      if (!a.exempt) { a.twoJobs = document.getElementById('tx_two').checked; a.kids = +v('tx_kids') || 0; a.otherDeps = +v('tx_deps') || 0; a.otherIncome = v('tx_oinc').replace(/[$,]/g, ''); a.deductions = v('tx_ded').replace(/[$,]/g, ''); a.extra = v('tx_extra').replace(/[$,]/g, ''); }
      if ([a.otherIncome, a.deductions, a.extra].some(function (x) { return x && !/^\d+(\.\d+)?$/.test(x); })) return { problem: 'Enter amounts as numbers, like 1500.' };
    } else {
      a.name = v('tx_name'); a.business = v('tx_biz'); a.requester = S.info.name;
      if (!a.name) return { problem: 'Fill in your name.' };
    }
    if (!document.getElementById('tx_perjury').checked) return { problem: 'Tick the statement above your signature.' };
    if (a.signature.length < 3) return { problem: 'Type your full name to sign.' };
    return { answers: a };
  }
  var pdfLibReady = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return pdfLibReady = pdfLibReady || new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = '/vendor/pdf-lib-1.17.1.min.js'; sc.onload = function () { ok(window.PDFLib); }; sc.onerror = function () { pdfLibReady = null; no(new Error('Couldn\'t load the form filler. Check your connection and try again.')); }; document.head.appendChild(sc); });
  }
  function makeTaxPdf(type, a) {
    var now = new Date();
    return Promise.all([loadPdfLib(), fetch('/irs/' + (type === 'W-4' ? 'fw4' : 'fw9') + '.pdf').then(function (r) { if (!r.ok) throw new Error('Couldn\'t load the IRS form.'); return r.arrayBuffer(); })]).then(function (x) {
      return window.TaxFill.fill(x[0], x[1], type, a, { date: now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }), stamp: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) });
    });
  }
  function bindTax(afterHire) {
    var redraw = function () { var box = document.getElementById('taxsec'); if (box) { box.outerHTML = taxSection(afterHire ? S.app.data : collect()); bindTax(afterHire); } };
    [].forEach.call($app.querySelectorAll('[name="taxtype"]'), function (r) { r.onchange = function () { S.taxType = r.value; redraw(); }; });
    var redo = document.getElementById('taxredo'); if (redo) redo.onclick = function (e) { e.preventDefault(); S.app.data = Object.assign({}, S.app.data, { tax_form: null }); if (!afterHire) save(true); redraw(); };
    var ex = document.getElementById('tx_exempt'); if (ex) ex.onchange = function () { document.getElementById('tx_more').hidden = ex.checked; };
    var typeNow = function () { var types = taxTypes(), picked = $app.querySelector('[name="taxtype"]:checked'); return types.length === 1 ? types[0] : picked && picked.value; };
    // Store a finished file in the private bucket and record it on the application.
    var store = function (blob, name, type, filled) {
      var ready = afterHire ? Promise.resolve() : save(true);
      return ready.then(function () {
        var path = S.info.camp_id + '/' + S.app.id + '/' + Date.now() + '-' + name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
        return sb.storage.from('tax-forms').upload(path, blob, { upsert: false, contentType: blob.type || 'application/octet-stream' }).then(function (r) {
          if (r.error) throw r.error;
          var t = { type: type, path: path, name: name, filled: !!filled, uploaded_at: new Date().toISOString() };
          if (afterHire) return sb.rpc('attach_tax_form', { p_app: S.app.id, p_type: type, p_path: path, p_name: name }).then(function (x) { if (x.error) throw x.error; S.app.data = Object.assign({}, S.app.data, { tax_form: t }); });
          S.app.data = Object.assign({}, S.app.data || {}, { tax_form: t });
          return save(true);
        });
      }).then(redraw);
    };
    var pv = document.getElementById('taxpreview'), sg = document.getElementById('taxsign');
    var go = function (preview) {
      var type = typeNow(), r = taxAnswers(type);
      var msg = document.getElementById('taxmsg'); if (msg) msg.remove();
      if (r.problem) { var p = document.createElement('div'); p.id = 'taxmsg'; p.className = 'error'; p.textContent = r.problem; document.getElementById('taxq').appendChild(p); return; }
      var w = preview ? window.open('', '_blank') : null;
      (preview ? pv : sg).disabled = true;
      makeTaxPdf(type, r.answers).then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        if (preview) { var url = URL.createObjectURL(blob); if (w) w.location = url; else window.open(url, '_blank'); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); pv.disabled = false; return; }
        var who = type === 'W-4' ? [r.answers.first, r.answers.last].join(' ') : r.answers.name;
        return store(blob, 'Form ' + type + ' ' + who + '.pdf', type, true);
      }).catch(function (e) { if (w) w.close(); (preview ? pv : sg).disabled = false; var p = document.createElement('div'); p.id = 'taxmsg'; p.className = 'error'; p.textContent = (e.message || String(e)) + ' You can also upload a filled-in form below.'; document.getElementById('taxq').appendChild(p); });
    };
    if (pv) pv.onclick = function () { go(true); };
    if (sg) sg.onclick = function () { go(false); };
    var inp = document.getElementById('taxfile'); if (!inp) return;
    inp.onchange = function () {
      var file = inp.files[0]; if (!file) return;
      var type = typeNow();
      if (!type) { alert('Choose W-4 or W-9 first.'); inp.value = ''; return; }
      if (file.size > 10 * 1024 * 1024) { alert('That file is over 10 MB. Try a PDF, or a smaller photo.'); inp.value = ''; return; }
      inp.disabled = true;
      store(file, file.name, type, false).catch(function (e) { inp.disabled = false; alert('The upload didn\'t work: ' + (e.message || e)); });
    };
  }
  // ---------- Staff application ----------
  function staffData() {
    var d = (S.app && S.app.data) || {};
    d.father = d.father || {}; d.mother = d.mother || {}; d.custom = d.custom || {};
    d.emergency = d.emergency && d.emergency.length ? d.emergency : [{}];
    d.camper_experience = d.camper_experience && d.camper_experience.length ? d.camper_experience : [{}];
    d.staff_experience = d.staff_experience && d.staff_experience.length ? d.staff_experience : [{}];
    if (!d.email && S.user) d.email = S.user.email;
    return d;
  }
  function staffForm(msg) {
    var d = staffData(), i = S.info, positions = i.positions || window.RegForm.POSITIONS, g = F('grade');
    var sel = function (key, inner) { var f = F(key); if (!f || f.mode === 'hidden') return ''; return '<label class="field">' + esc(f.label) + (f.mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '<select data-k="' + key + '"' + (f.mode === 'required' ? ' data-req' : '') + '><option value="">Choose…</option>' + inner + '</select></label>'; };
    var exp = function (kind, rows, cols) {
      var key = 'experience.' + kind; if (!asks(key)) return '';
      var f = F(key), list = kind === 'camper' ? 'camper_experience' : 'staff_experience', none = d['no_' + list];
      return '<div class="field" style="font-weight:700;margin-top:10px">' + esc(f.label) + (f.mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '</div>' +
        '<div data-exp="' + list + '"' + (none ? ' hidden' : '') + '>' + rows.map(function (r, n) {
          return '<div class="row2 exprow">' + cols.map(function (c) { return '<label class="field">' + c[1] + '<input type="text" data-k="' + list + '.' + n + '.' + c[0] + '" value="' + esc(r[c[0]] || '') + '" maxlength="120"' + (c[2] ? ' placeholder="' + c[2] + '"' : '') + '></label>'; }).join('') + '</div>';
        }).join('') + '<p><button type="button" data-addexp="' + list + '">+ Add another camp</button></p></div>' +
        '<label class="check"><input type="checkbox" data-none="no_' + list + '"' + (none ? ' checked' : '') + '><span>None</span></label>';
    };
    show('<h1>Apply to work at ' + esc(i.name) + (i.sessionName ? ': ' + esc(i.sessionName) : '') + '</h1>' + (i.intro ? '<p style="white-space:pre-line">' + esc(i.intro) + '</p>' : '') +
      '<p class="small muted">Signed in as ' + esc(S.user.email) + ' · <a href="#" id="out">Sign out</a> · <span class="saved" id="saved">Your answers are saved as you go.</span></p>' +
      (msg ? '<div class="error">' + esc(msg) + '</div>' : '') + '<form id="appf" novalidate>' +
      '<fieldset class="sec"><legend>About you</legend><div class="row2">' + input('first', 'first', d.first, { auto: 'given-name' }) + input('last', 'last', d.last, { auto: 'family-name' }) +
      input('dob', 'dob', d.dob, { type: 'date' }) + sel('gender', '<option value="Male"' + (d.gender === 'Male' ? ' selected' : '') + '>Male</option><option value="Female"' + (d.gender === 'Female' ? ' selected' : '') + '>Female</option>') +
      input('phone', 'phone', d.phone, { type: 'tel', auto: 'tel', inputmode: 'tel', max: 40 }) + input('email', 'email', d.email, { type: 'email', auto: 'email', max: 160 }) +
      input('hebrew_name', 'hebrew_name', d.hebrew_name) + '</div>' + input('address', 'address', d.address, { auto: 'street-address', max: 160 }) + '<div class="row2">' +
      input('city', 'city', d.city, { auto: 'address-level2' }) + input('state', 'state', d.state, { auto: 'address-level1', max: 40 }) + input('zip', 'zip', d.zip, { auto: 'postal-code', inputmode: 'numeric', max: 10 }) +
      input('school', 'school', d.school, { max: 160 }) + sel('grade', (g ? g.options : []).map(function (x) { return '<option' + (d.grade === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('')) + '</div>' +
      customs('applicant', 'custom.', d.custom) + '</fieldset>' +
      '<fieldset class="sec"><legend>The job</legend><div class="field" style="font-weight:700">' + esc(F('positions').label) + ' <span class="small muted">(choose all that interest you)</span></div><div class="sessions" data-positions>' +
      positions.map(function (p) { return '<label class="check"><input type="checkbox" value="' + esc(p) + '"' + ((d.positions || []).indexOf(p) >= 0 ? ' checked' : '') + '><span>' + esc(p) + '</span></label>'; }).join('') + '</div>' +
      (i.sessions.length && asks('sessions') ? '<div class="field" style="font-weight:700">' + esc(F('sessions').label) + (F('sessions').mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '</div><div class="sessions" data-staffsessions>' + i.sessions.map(function (x) {
        return '<label class="check"><input type="checkbox" value="' + esc(x.id) + '"' + ((d.sessions || []).indexOf(x.id) >= 0 ? ' checked' : '') + '><span>' + esc(x.name) + (range(x) ? ' <span class="muted small">' + esc(range(x)) + '</span>' : '') + '</span></label>'; }).join('') + '</div>' : '') +
      customs('job', 'custom.', d.custom) + '</fieldset>' +
      (asks('parent.first') ? '<fieldset class="sec"><legend>Parents</legend>' + ['father', 'mother'].map(function (w) {
        var p = d[w];
        return '<h3 style="margin:8px 0 0">' + (w === 'father' ? 'Father' : 'Mother') + '</h3><div class="row2">' + input('parent.first', w + '.first', p.first, { label: 'First name', parent: true, noMark: true }) +
          input('parent.phone', w + '.phone', p.phone, { label: 'Cell phone', type: 'tel', inputmode: 'tel', max: 40, parent: true, noMark: true }) + input('parent.email', w + '.email', p.email, { label: 'Email', type: 'email', max: 160, parent: true, noMark: true }) + '</div>';
      }).join('') + (F('parent.first').mode === 'required' ? '<p class="small muted">At least one parent.</p>' : '') + customs('parents', 'custom.', d.custom) + '</fieldset>' : '') +
      (asks('emergency') ? '<fieldset class="sec"><legend>Emergency contact</legend>' + d.emergency.slice(0, 1).map(function (e) {
        return '<div class="row2">' + input('emergency', 'emergency.0.name', e.name, { label: 'Name' }) + input('emergency', 'emergency.0.phone', e.phone, { label: 'Phone', type: 'tel', inputmode: 'tel', max: 40 }) + input('emergency.relation', 'emergency.0.relation', e.relation, { max: 60 }) + '</div>';
      }).join('') + customs('emergency', 'custom.', d.custom) + '</fieldset>' : '') +
      '<fieldset class="sec"><legend>Camp experience</legend>' +
      exp('camper', d.camper_experience, [['camp', 'Camp'], ['years', 'Years', 'e.g. 2019–2023']]) +
      exp('staff', d.staff_experience, [['camp', 'Camp'], ['position', 'Position'], ['years', 'Years', 'e.g. 2025']]) +
      customs('experience', 'custom.', d.custom) + '</fieldset>' +
      (i.tax_form && i.tax_form !== 'none' && i.tax_when !== 'hired' ? taxSection(d) : '') +
      ((asks('notes') || window.RegForm.custom(i.form, 'other').length) ? '<fieldset class="sec"><legend>Anything else?</legend>' + (asks('notes') ? '<label class="field">' + esc(F('notes').label) + (F('notes').mode === 'optional' ? ' <span class="small muted">(optional)</span>' : '') + '<textarea data-k="notes" maxlength="2000" rows="3"' + (F('notes').mode === 'required' ? ' data-req' : '') + '>' + esc(d.notes || '') + '</textarea></label>' : '') + customs('other', 'custom.', d.custom) + '</fieldset>' : '') +
      '<fieldset class="sec"><legend>Agreement</legend>' + (i.agreement ? '<div class="consent-text agree">' + esc(i.agreement) + '</div>' : '') +
      '<label class="check" style="margin-top:12px"><input type="checkbox" id="agree"><span>' + (i.agreement ? 'I have read and agree to the above.' : 'The information in this application is correct.') + '</span></label>' +
      '<label class="field">Type your full name to sign<input type="text" id="sig" maxlength="200" autocomplete="name" value="' + esc((S.app && S.app.signature) || '') + '"></label></fieldset>' +
      '<p><button class="primary" id="sendapp" style="width:100%">Send application</button></p></form>');
    bindOut();
    var f = document.getElementById('appf');
    f.addEventListener('input', function () { save(); });
    f.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.none) { var box = $app.querySelector('[data-exp="' + e.target.dataset.none.slice(3) + '"]'); if (box) box.hidden = e.target.checked; }
      save();
    });
    bindTax(false);
    [].forEach.call($app.querySelectorAll('[data-addexp]'), function (b) { b.onclick = function () { var d2 = collect(); d2[b.dataset.addexp].push({}); S.app = Object.assign(S.app || {}, { data: d2 }); staffForm(); save(); }; });
    f.onsubmit = function (e) { e.preventDefault(); submit(); };
  }
  function staffProblems(d, mark) {
    var out = [];
    if (!(d.positions || []).length) out.push('at least one position');
    if (S.info.sessions.length && asks('sessions') && F('sessions').mode === 'required' && !(d.sessions || []).length) out.push('the sessions you can work');
    if (asks('parent.first') && F('parent.first').mode === 'required') {
      var need = ['first'].concat(F('parent.phone').mode === 'required' ? ['phone'] : []).concat(F('parent.email').mode === 'required' ? ['email'] : []);
      if (!['father', 'mother'].some(function (w) { return need.every(function (k) { return d[w][k]; }); })) { out.push('a parent\'s ' + need.map(function (k) { return { first: 'name', phone: 'cell phone', email: 'email' }[k]; }).join(' and ')); need.forEach(function (k) { if (!d.father[k]) mark($app.querySelector('[data-k="father.' + k + '"]')); }); }
    }
    ['camper', 'staff'].forEach(function (k) {
      var key = 'experience.' + k, list = k + '_experience';
      if (!asks(key) || F(key).mode !== 'required') return;
      if (!d['no_' + list] && !(d[list] || []).some(function (r) { return r && r.camp; })) { out.push(k === 'camper' ? 'camps you went to as a camper (or tick None)' : 'camps you worked at (or tick None)'); mark($app.querySelector('[data-k="' + list + '.0.camp"]')); }
    });
    if (S.info.tax_form && S.info.tax_form !== 'none' && S.info.tax_when !== 'hired' && !(S.app && S.app.data && S.app.data.tax_form && S.app.data.tax_form.path)) out.push('your tax form (' + taxTypes().join(' or ') + '): sign it or upload it');
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { out.push('a valid email'); mark($app.querySelector('[data-k="email"]')); }
    if (!document.getElementById('agree').checked) out.push('the agreement checkbox');
    if (!document.getElementById('sig').value.trim()) { out.push('your signature'); mark(document.getElementById('sig')); }
    return out;
  }
  function staffStatus() {
    var a = S.app, d = a.data || {}, i = S.info;
    var head = {
      submitted: ['We received your application', 'The camp office will review it and be in touch at ' + esc(a.email) + '.'],
      waitlisted: ['You\'re on our waiting list', 'We\'ll be in touch if a position opens up.'],
      accepted: ['You\'re hired!', 'Welcome to the ' + esc(i.name) + ' staff. Watch for an email with next steps.'],
      declined: ['Thank you for applying', 'We\'re not able to offer you a position this time.'],
      withdrawn: ['Application withdrawn', '']
    }[a.status] || ['Application', ''];
    var sess = {}; i.sessions.forEach(function (x) { sess[x.id] = x.name; });
    var rows = function (list, cols) { return (list || []).filter(function (r) { return r && r.camp; }).map(function (r) { return esc(cols.map(function (c) { return r[c]; }).filter(Boolean).join(', ')); }).join('<br>') || 'None'; };
    var needTax = a.status === 'accepted' && i.tax_form && i.tax_form !== 'none' && i.tax_when === 'hired';
    show('<h1>' + esc(i.name) + '</h1><div class="status"><h2 style="margin:0 0 6px">' + head[0] + '</h2><p style="margin:0">' + head[1] + '</p></div>' +
      (needTax ? '<p style="margin-top:18px"><strong>Next step:</strong> please send us your tax form.</p>' + taxSection(d) : '') +
      '<h2 style="margin-top:26px">Your application</h2><dl class="sum">' +
      '<dt>Name</dt><dd>' + esc([d.first, d.last].filter(Boolean).join(' ')) + (d.grade ? ', ' + esc(d.grade) : '') + (d.school ? ' · ' + esc(d.school) : '') + '</dd>' +
      '<dt>Positions</dt><dd>' + esc((d.positions || []).join(', ')) + '</dd>' +
      ((d.sessions || []).length ? '<dt>Sessions</dt><dd>' + esc(d.sessions.map(function (x) { return sess[x] || ''; }).filter(Boolean).join(' & ')) + '</dd>' : '') +
      '<dt>As a camper</dt><dd>' + rows(d.camper_experience, ['camp', 'years']) + '</dd><dt>On staff</dt><dd>' + rows(d.staff_experience, ['camp', 'position', 'years']) + '</dd>' +
      '<dt>Sent</dt><dd>' + esc(a.submitted_at ? new Date(a.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '') + ' · signed by ' + esc(a.signature || '') + '</dd></dl>' +
      (i.contact ? '<p>Need to change something? Email <a href="mailto:' + esc(i.contact) + '">' + esc(i.contact) + '</a>.</p>' : '') +
      '<p class="small muted">Signed in as ' + esc(S.user.email) + ' · <a href="#" id="out">Sign out</a></p>');
    bindOut();
    bindTax(true);
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
