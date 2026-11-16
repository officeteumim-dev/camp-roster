// Staff app: forms dashboard, camper records, bunks, money (read-only), imports, settings.
// What each person can see is enforced by the database; this file only decides what to show.
(function () {
  'use strict';
  var cfg = window.ROSTER_CONFIG;
  // Stay signed in on this device until "Sign out": the session is kept in this browser and renewed automatically.
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // Ask the phone not to clear this site's saved sign-in when space runs low (Android and home-screen apps honor it).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
  // DB is the real database, or Camp Test Site's in-browser stand-in (demo-db.js) while someone is in the test camp.
  var DB = sb, DEMO = window.DemoDB;
  var $main = document.getElementById('main'), $top = document.getElementById('top');
  var S = { user: null, access: [], camp: null, roles: [], reqs: [], sessions: [], status: null, filters: { q: '', session: '', missing: '', sort: 'name' } };

  // ---------- small helpers ----------
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var has = function () { for (var i = 0; i < arguments.length; i++) if (S.roles.indexOf(arguments[i]) >= 0) return true; return false; };
  // What this person may see or change, from the camp's who-sees-what table (Settings). The database enforces the same table.
  var can = function (item, mode) { if (!S.perms) return false; if (S.perms.director) return true; var x = S.perms.items[item]; return !!(x && (mode === 'change' ? x.change : (x.see || x.change))); };
  var isDirector = function () { return !!(S.perms && S.perms.director); };
  // Covers more than one bunk (whole camp or a session), as opposed to someone limited to their own bunk.
  var wide = function () { return isDirector() || (S.perms && S.perms.roles.some(function (r) { return r.scope !== 'bunk'; })); };
  var roleLabel = function (key) { var r = (S.roleList || []).find(function (x) { return x.key === key; }); return r ? r.label : (ROLE_NAMES[key] || key); };
  var money = function (c) { return c == null ? '' : (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var when = function (iso) { return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
  var day = function (iso) { return iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  function must(res) { if (res.error) throw Object.assign(new Error(res.error.message), { expected: !!res.error.expected }); return res.data; }
  function fail(e) { if (!e.expected) console.error(e); toast(e.message || 'Something went wrong'); }
  var said = function (msg) { return Object.assign(new Error(msg), { expected: true }); };
  var ROLE_NAMES = { director: 'Director', office: 'Office', finance: 'Finance', infirmary: 'Infirmary', head_counselor: 'Head counselor', counselor: 'Counselor' };
  var STATUS = {
    approved: ['good', 'Approved'], received: ['info', 'Received'], not_needed: ['good', 'Not needed'],
    rejected: ['bad', 'Rejected'], missing: ['warn', 'Missing']
  };
  var chip = function (s) { var x = STATUS[s] || ['none', s]; return '<span class="chip ' + x[0] + '">' + x[1] + '</span>'; };

  function fn(name, body, opts) {
    if (S.demo) {
      if (name === 'notify' && body.action === 'link') return Promise.resolve({ link: location.origin + '/portal.html?demo=' + encodeURIComponent(body.family_ids[0]) });
      if (name === 'notify' && body.action === 'rejected') return Promise.resolve({ sent: 0 });
      if (name === 'notify' && body.action === 'report_now') return DB.rpc('report_now', {}).then(must);
      if (name === 'notify') return Promise.reject(said('Emails aren\'t sent from ' + DEMO.NAME + '. In your own camp, this emails the families.'));
      return Promise.reject(said('Imports are turned off in ' + DEMO.NAME + '. In your own camp, Camp Flow reports are imported here.'));
    }
    return sb.auth.getSession().then(function (r) {
      var tok = r.data.session && r.data.session.access_token;
      return fetch(cfg.supabaseUrl + '/functions/v1/' + name + (opts && opts.query ? opts.query : ''), {
        method: 'POST', body: opts && opts.raw ? body : JSON.stringify(body),
        headers: Object.assign({ apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + tok }, opts && opts.raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' })
      }).then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || 'Request failed'); return j; }); });
    });
  }

  // ---------- sign in ----------
  // Like the SFSP app: Google opens in a pop-up and email + password stays on this page, so a home-screen app
  // signs itself in (a full-page redirect or an emailed link would sign in the phone's browser instead).
  function showSignIn(msg, mode) {
    hideChrome();
    mode = mode || 'in';
    var title = { in: 'Sign in', up: 'Create an account', forgot: 'Reset your password', reset: 'Choose a new password' }[mode];
    $main.innerHTML = '<div class="card signin"><span class="logo" role="img" aria-label="Camp Roster by W Group"></span><h1>Camp Roster</h1>' +
      (mode === 'in' ? '<p class="muted">Rosters, registration and health forms for camps.</p>' : '<h2 style="font-size:16px;margin:4px 0 10px">' + title + '</h2>') +
      (msg ? '<div class="' + (/^✓/.test(msg) ? 'notice' : 'error') + '">' + esc(msg.replace(/^✓\s*/, '')) + '</div>' : '') +
      (mode === 'in' || mode === 'up' ? '<p><button class="primary" id="g" style="width:100%">Continue with Google</button></p><div class="or"><span>or</span></div>' : '') +
      '<form id="pw">' +
      (mode !== 'reset' ? '<label class="field">Email<input type="email" id="em" required autocomplete="email"></label>' : '') +
      (mode !== 'forgot' ? '<label class="field">' + (mode === 'reset' ? 'New password' : 'Password') + '<input type="password" id="pwd" required minlength="8" autocomplete="' + (mode === 'in' ? 'current-password' : 'new-password') + '"></label>' : '') +
      '<button class="primary" style="width:100%">' + { in: 'Sign in', up: 'Create account', forgot: 'Email me a reset link', reset: 'Save password' }[mode] + '</button></form>' +
      '<p class="small" style="margin-top:14px;text-align:center">' +
      (mode === 'in' ? '<a href="#" data-mode="forgot">Forgot password?</a> · New here? <a href="#" data-mode="up">Create an account</a>' : mode === 'reset' ? '' : '<a href="#" data-mode="in">Back to sign in</a>') + '</p></div>';
    [].forEach.call($main.querySelectorAll('[data-mode]'), function (a) { a.onclick = function (e) { e.preventDefault(); showSignIn(null, a.dataset.mode); }; });
    var g = document.getElementById('g'); if (g) g.onclick = googleSignIn;
    document.getElementById('pw').onsubmit = function (e) {
      e.preventDefault();
      var em = document.getElementById('em'), pw = document.getElementById('pwd');
      var email = em && em.value.trim().toLowerCase(), pass = pw && pw.value;
      var btn = e.target.querySelector('button'); btn.disabled = true;
      var done = function () { btn.disabled = false; };
      var go = mode === 'in' ? sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
          if (r.error) throw said(/confirm/i.test(r.error.message) ? 'Please confirm your email first: open the link we sent you, then sign in here.' : 'That email and password don\'t match. Try again, or use "Forgot password?".');
          start();
        })
        : mode === 'up' ? sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: location.origin + '/' } }).then(function (r) {
          if (r.error) throw said(r.error.message);
          if (r.data.session) return start();
          showSignIn('✓ Almost done: we emailed ' + email + ' a link to confirm the address. Open it, then sign in here.', 'in');
        })
        : mode === 'forgot' ? sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' }).then(function (r) {
          if (r.error) throw said(r.error.message);
          showSignIn('✓ If ' + email + ' has an account, we emailed it a link to choose a new password.', 'in');
        })
        : sb.auth.updateUser({ password: pass }).then(function (r) { if (r.error) throw said(r.error.message); toast('Password saved'); start(); });
      go.catch(fail).then(done);
    };
  }
  function googleSignIn() {
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/?popup=1', skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } }).then(function (r) {
      if (r.error) throw r.error;
      var w = window.open(r.data.url, 'roster-google', 'width=500,height=650');
      if (!w) location.href = r.data.url;   // pop-ups blocked: go the long way round
    }).catch(fail);
  }
  // The Google pop-up lands back here: hand the sign-in to the app window and close.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'roster-signed-in') return;
    sb.auth.setSession({ access_token: e.data.access_token, refresh_token: e.data.refresh_token }).then(function (r) { if (r.error) throw r.error; if (!S.camp) start(); }).catch(fail);
  });

  function start() {
    // A failed Google or email sign-in comes back as ?error_description=... : say so instead of a silent sign-in page.
    var q = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
    if (q.get('error_description')) {
      var why = q.get('error_description');
      history.replaceState(null, '', location.pathname);
      return showSignIn('Sign-in didn\'t work: ' + why.replace(/\+/g, ' ') + '. Try again, or use your email and password.');
    }
    sb.auth.getSession().then(function (r) {
      var s = r.data.session;
      if (/[?&]popup=1/.test(location.search) && window.opener) {
        try { if (s) window.opener.postMessage({ type: 'roster-signed-in', access_token: s.access_token, refresh_token: s.refresh_token }, location.origin); } catch (e) { }
        if (s) { $main.innerHTML = '<div class="card signin"><p>Signed in. You can close this window.</p></div>'; window.close(); return; }
      }
      if (/[?&]popup=1/.test(location.search)) history.replaceState(null, '', location.pathname);
      if (S.recovering) return showSignIn(null, 'reset');
      if (!s) return showSignIn();
      S.user = s.user;
      return Promise.all([sb.rpc('my_access'), sb.rpc('site_info')]).then(function (res) {
        S.access = must(res[0]);
        S.site = (!res[1].error && res[1].data) || { admin: false, public_test_camp: false };
        var real = S.access.length;
        // Camp Test Site: for everyone with a camp; for everyone else only once the owner opens it to the public.
        var demoOk = real || S.site.admin || S.site.public_test_camp;
        if (demoOk) S.access.push({ camp_id: DEMO.CAMP, camp_name: DEMO.NAME, role: 'director', session_id: null, bunk_id: null });
        var saved = localStorage.getItem('camp');
        if (!real && !(demoOk && saved === DEMO.CAMP)) return showNoAccess();
        pickCamp(S.access.some(function (a) { return a.camp_id === saved; }) ? saved : S.access[0].camp_id);
      });
    }).catch(fail);
  }

  // Signed in, but not on any camp's staff: ask to open a camp (or see how that request stands).
  function showNoAccess() {
    hideChrome();
    var r = S.site.my_request, demoOk = S.site.admin || S.site.public_test_camp;
    var demoBtn = demoOk ? '<button id="godemo">Explore ' + DEMO.NAME + '</button>' : '';
    var html = '<div class="card signin wide"><span class="logo" role="img" aria-label="Camp Roster by W Group"></span><h1>Camp Roster</h1>';
    if (r && r.status === 'pending') {
      html += '<p><strong>Thanks, ' + esc(r.name) + '.</strong> Your request to open <strong>' + esc(r.camp_name) + '</strong> is waiting for approval. We\'ll email ' + esc(S.user.email) + ' when your camp is ready.</p>' +
        '<p class="small muted">Sent ' + esc(when(r.created_at)) + '. Joining a camp that already uses Camp Roster? Ask its director to add ' + esc(S.user.email) + ' instead.</p>';
    } else {
      html += '<p>Your account (' + esc(S.user.email) + ') isn\'t part of a camp yet. <strong>Staff:</strong> ask your camp director to add this address. <strong>Running a camp?</strong> Ask to open one below.</p>' +
        (r && r.status === 'declined' ? '<p class="small muted">Your earlier request for ' + esc(r.camp_name) + ' wasn\'t approved. You\'re welcome to send a new one.</p>' : '') +
        '<form id="reqf"><h2>Ask to open a camp</h2>' +
        '<label class="field">Your name<input type="text" id="rq_name" required maxlength="120" autocomplete="name"></label>' +
        '<label class="field">Camp name<input type="text" id="rq_camp" required minlength="2" maxlength="120"></label>' +
        '<label class="field">Where is the camp? <span class="small muted">(optional)</span><input type="text" id="rq_loc" maxlength="160" placeholder="City, state"></label>' +
        '<label class="field">About how many campers? <span class="small muted">(optional)</span><input type="text" id="rq_n" maxlength="40"></label>' +
        '<label class="field">Phone <span class="small muted">(optional)</span><input type="tel" id="rq_ph" maxlength="40" autocomplete="tel"></label>' +
        '<label class="field">Anything else we should know? <span class="small muted">(optional)</span><textarea id="rq_msg" maxlength="2000" rows="3"></textarea></label>' +
        '<button class="primary">Send request</button></form>';
    }
    html += '<p class="row" style="margin-top:16px">' + demoBtn + '<button id="out2">Sign out</button></p></div>';
    $main.innerHTML = html;
    var gd = document.getElementById('godemo'); if (gd) gd.onclick = function () { pickCamp(DEMO.CAMP); };
    document.getElementById('out2').onclick = function () { DEMO.clear(S.user.email); sb.auth.signOut().then(function () { showSignIn(); }); };
    var f = document.getElementById('reqf');
    if (f) f.onsubmit = function (e) {
      e.preventDefault();
      var v = function (id) { return document.getElementById(id).value.trim() || null; };
      var btn = f.querySelector('button.primary'); btn.disabled = true;
      sb.from('camp_requests').insert({ name: v('rq_name'), camp_name: v('rq_camp'), location: v('rq_loc'), campers: v('rq_n'), phone: v('rq_ph'), message: v('rq_msg') }).select().single()
        .then(must).then(function (row) {
          S.site.my_request = Object.assign({ status: 'pending', created_at: new Date().toISOString() }, row);
          fn('notify', { action: 'camp_request', id: row.id }).catch(function () { });   // the owner also sees it under Camp requests
          showNoAccess();
        }).catch(function (e2) { btn.disabled = false; fail(/one_pending|duplicate/.test(e2.message) ? said('You already have a request waiting.') : e2); });
    };
  }

  // ---------- Camp requests (site owner) ----------
  function requestsPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([sb.from('camp_requests').select('*').order('created_at', { ascending: false }).limit(200), sb.from('site_settings').select('*').maybeSingle()]).then(function (r) {
      var list = must(r[0]) || [], set = must(r[1]) || {};
      var pend = list.filter(function (x) { return x.status === 'pending'; }), done = list.filter(function (x) { return x.status !== 'pending'; });
      var row = function (x) {
        return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0">' + esc(x.camp_name) + '</h2><p class="small muted" style="margin:2px 0 8px">' + esc(x.name) + ' · ' + esc(x.email) + (x.phone ? ' · ' + esc(x.phone) : '') + ' · ' + esc(when(x.created_at)) + '</p>' +
          (x.location ? '<div class="small"><strong>Where:</strong> ' + esc(x.location) + '</div>' : '') + (x.campers ? '<div class="small"><strong>Campers:</strong> ' + esc(x.campers) + '</div>' : '') +
          (x.message ? '<p class="small" style="white-space:pre-line">' + esc(x.message) + '</p>' : '') + '</div>' +
          (x.status === 'pending' ? '<div class="row"><button class="primary" data-approve-req="' + x.id + '">Approve</button><button data-decline-req="' + x.id + '">Decline</button></div>'
            : '<span class="chip ' + (x.status === 'approved' ? 'good' : 'none') + '">' + (x.status === 'approved' ? 'Approved' : 'Declined') + '</span>') + '</div></div>';
      };
      $main.innerHTML = '<h1>Camp requests</h1><p class="muted" style="max-width:820px">Anyone can sign in, but only people you approve here (or that a camp director adds as staff) get into a camp. Approving makes the camp, with the standard forms, roles and settings, and makes the person who asked its director. They\'re emailed either way.</p>' +
        '<div class="card"><label class="check"><input type="checkbox" id="pubdemo"' + (set.public_test_camp ? ' checked' : '') + '><span>Let people without a camp explore ' + DEMO.NAME + ' <span class="small muted">(the practice camp; nothing they do there is saved)</span></span></label></div>' +
        '<h2>Waiting (' + pend.length + ')</h2>' + (pend.length ? pend.map(row).join('') : '<p class="muted">No requests waiting.</p>') +
        (done.length ? '<h2>Decided</h2>' + done.map(row).join('') : '');
      document.getElementById('pubdemo').onchange = function (e) {
        sb.from('site_settings').update({ public_test_camp: e.target.checked, updated_at: new Date().toISOString() }).eq('id', true).then(must)
          .then(function () { S.site.public_test_camp = e.target.checked; toast(e.target.checked ? 'Anyone signed in can now explore ' + DEMO.NAME + '.' : DEMO.NAME + ' is for camp staff only again.'); }).catch(fail);
      };
      var answer = function (id) { return fn('notify', { action: 'camp_request_answer', id: id }).catch(function (e) { toast('Saved, but the email didn\'t go out: ' + e.message); }); };
      [].forEach.call($main.querySelectorAll('[data-approve-req]'), function (b) {
        b.onclick = function () {
          var x = list.find(function (q) { return q.id === b.dataset.approveReq; });
          var name = prompt('Approve and open this camp? You can adjust its name:', x.camp_name); if (name === null) return;
          b.disabled = true;
          sb.rpc('approve_camp_request', { p_id: x.id, p_camp_name: name }).then(must).then(function () { return answer(x.id); })
            .then(function () { toast(name + ' is open. ' + x.email + ' is its director.'); S.site.pending_requests = Math.max(0, (S.site.pending_requests || 1) - 1); drawTop(); requestsPage(); }).catch(function (e) { b.disabled = false; fail(e); });
        };
      });
      [].forEach.call($main.querySelectorAll('[data-decline-req]'), function (b) {
        b.onclick = function () {
          if (!confirm('Decline this request? They\'ll get a short email saying so.')) return;
          sb.rpc('decline_camp_request', { p_id: b.dataset.declineReq }).then(must).then(function () { return answer(b.dataset.declineReq); })
            .then(function () { toast('Declined'); S.site.pending_requests = Math.max(0, (S.site.pending_requests || 1) - 1); drawTop(); requestsPage(); }).catch(fail);
        };
      });
    }).catch(fail);
  }

  function pickCamp(id) {
    var toDemo = id === DEMO.CAMP;
    if (S.demo && !toDemo) DEMO.clear(S.user.email);   // leaving the test camp wipes it
    S.demo = toDemo;
    DB = toDemo ? DEMO.client(S.user.email) : sb;
    if (toDemo) {
      try { sessionStorage.setItem('roster-demo-current', S.user.email); } catch (e) { }
      // In the test camp, the person can view the app as any role ("Viewing as" in the banner).
      var r = DB.role(), entry = S.access.find(function (a) { return a.camp_id === DEMO.CAMP; });
      entry.role = r.role; entry.session_id = r.session_id || null; entry.bunk_id = r.bunk_id || null;
    }
    S.roster = null; S.rf = null; S.filters = { q: '', session: '', missing: '', sort: 'name' };
    // A camper page belongs to one camp: switching camps goes back to the list.
    if (S.camp && S.camp.id !== id && /^#camper\//.test(location.hash)) history.replaceState(null, '', location.pathname + '#roster');
    localStorage.setItem('camp', id);
    S.roles = S.access.filter(function (a) { return a.camp_id === id; }).map(function (a) { return a.role; });
    S.myBunks = S.access.filter(function (a) { return a.camp_id === id && a.bunk_id; }).map(function (a) { return a.bunk_id; });
    S.status = null;
    Promise.all([
      DB.from('camps').select('*').eq('id', id).single(),
      DB.from('requirements').select('*').eq('camp_id', id).order('sort'),
      DB.from('sessions').select('*').eq('camp_id', id).order('starts_on', { nullsFirst: false }).order('name'),
      DB.rpc('my_permissions', { p_camp: id }),
      DB.from('roles').select('*').eq('camp_id', id).order('sort'),
      DB.from('perm_items').select('*').eq('camp_id', id).order('sort')
    ]).then(function (r) {
      S.camp = must(r[0]); S.reqs = must(r[1]); S.sessions = must(r[2]);
      S.perms = must(r[3]) || { director: false, items: {}, roles: [] };
      S.roleList = must(r[4]); S.items = must(r[5]);
      S.myBunks = S.perms.roles.filter(function (x) { return x.scope === 'bunk' && x.bunk_id; }).map(function (x) { return x.bunk_id; });
      drawTop(); route();
    }).catch(fail);
  }

  // Menu icons (the same Lucide line icons the SFSP app uses).
  var svg = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var ICON = {
    roster: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    forms: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    bunks: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
    mybunk: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    money: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    imports: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    reports: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 18v-2"/><path d="M12 18v-4"/><path d="M16 18v-6"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    requests: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
    menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };
  // [key, label, group, who can see it]
  var PAGES = [
    ['roster', 'Roster', 'Campers', function () { return can('roster'); }],
    ['forms', 'Forms', 'Campers', function () { return can('form_status'); }],
    ['bunks', 'Bunks', 'Campers', function () { return can('bunks') && wide(); }],
    ['mybunk', 'My bunk', 'Campers', function () { return can('bunks') && !wide() && S.myBunks.length; }],
    ['money', 'Money', 'Office', function () { return can('money'); }],
    ['imports', 'Imports', 'Office', function () { return can('imports'); }],
    ['reports', 'Reports', 'Office', function () { return can('reports'); }],
    ['settings', 'Settings', 'Setup', function () { return isDirector(); }],
    ['activity', 'Activity', 'Setup', function () { return can('activity'); }],
    ['requests', 'Camp requests', 'Setup', function () { return S.site && S.site.admin && !S.demo; }]
  ];
  var allowedPages = function () { return PAGES.filter(function (p) { return p[3](); }); };

  // ---------- menu: sidebar on wide screens (the menu button shrinks it to icons), slide-in panel on phones ----------
  var $drawer = document.getElementById('drawer'), $drawerBg = document.getElementById('drawerBg'), $bot = document.getElementById('botbar'), $menuBtn = document.getElementById('menuBtn');
  var wideScreen = function () { return window.matchMedia('(min-width:1024px)').matches; };
  function syncSide() {
    var mini = false; try { mini = localStorage.getItem('roster-side-mini') === '1'; } catch (e) { }
    document.body.classList.toggle('mini', mini);
    if (wideScreen()) {
      $drawer.classList.remove('open'); $drawerBg.hidden = true; $drawerBg.classList.remove('open');
      $drawer.setAttribute('aria-hidden', 'false'); $drawer.inert = false;
      $menuBtn.setAttribute('aria-label', mini ? 'Expand menu' : 'Collapse menu'); $menuBtn.setAttribute('aria-expanded', mini ? 'false' : 'true');
    } else {
      var open = $drawer.classList.contains('open');
      $drawer.setAttribute('aria-hidden', open ? 'false' : 'true'); $drawer.inert = !open;
      $menuBtn.setAttribute('aria-label', 'Open menu'); $menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    [].forEach.call($drawer.querySelectorAll('nav a'), function (a) { a.title = wideScreen() && mini ? a.textContent : ''; });
  }
  function openDrawer() { $drawer.classList.add('open'); $drawerBg.hidden = false; requestAnimationFrame(function () { $drawerBg.classList.add('open'); }); syncSide(); var a = $drawer.querySelector('[aria-current="page"]') || $drawer.querySelector('a'); if (a) a.focus(); }
  function closeDrawer() { if (!$drawer.classList.contains('open')) return; $drawer.classList.remove('open'); $drawerBg.classList.remove('open'); setTimeout(function () { if (!$drawer.classList.contains('open')) $drawerBg.hidden = true; }, 200); syncSide(); }
  $menuBtn.onclick = function () {
    if (wideScreen()) { try { localStorage.setItem('roster-side-mini', document.body.classList.contains('mini') ? '0' : '1'); } catch (e) { } syncSide(); }
    else openDrawer();
  };
  $drawerBg.onclick = closeDrawer;
  $drawer.addEventListener('click', function (e) { if (e.target.closest('nav a') || e.target.closest('[data-close]')) closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $drawer.classList.contains('open')) { closeDrawer(); $menuBtn.focus(); } });
  window.addEventListener('resize', function () { clearTimeout(window.__sideT); window.__sideT = setTimeout(syncSide, 120); });
  function hideChrome() {
    $top.hidden = true; $drawer.hidden = true; $drawerBg.hidden = true; $bot.hidden = true;
    document.body.classList.remove('side', 'has-bot');
  }

  function drawTop() {
    var camps = []; S.access.forEach(function (a) { if (!camps.some(function (c) { return c.id === a.camp_id; })) camps.push({ id: a.camp_id, name: a.camp_name }); });
    var pages = allowedPages();
    $top.hidden = false;
    document.getElementById('campName').textContent = S.camp.name;
    var groups = [];
    pages.forEach(function (p) { var g = groups.find(function (x) { return x.name === p[2]; }); if (!g) groups.push(g = { name: p[2], pages: [] }); g.pages.push(p); });
    var link = function (p) { return '<a href="#' + p[0] + '" data-p="' + p[0] + '">' + svg(ICON[p[0]]) + '<span>' + p[1] + (p[0] === 'requests' && S.site.pending_requests ? ' <span class="chip warn" aria-label="' + S.site.pending_requests + ' waiting">' + S.site.pending_requests + '</span>' : '') + '</span></a>'; };
    $drawer.innerHTML = '<div class="drawer-head"><span class="logo" role="img" aria-label="Camp Roster by W Group"></span><b>' + esc(S.camp.name) + '</b><button class="iconbtn" data-close aria-label="Close menu">' + svg(ICON.close) + '</button></div>' +
      '<div class="drawer-acct">' + (camps.length > 1 ? '<select id="campsel" aria-label="Camp">' + camps.map(function (c) { return '<option value="' + c.id + '"' + (c.id === S.camp.id ? ' selected' : '') + '>' + esc(c.name) + (c.id === DEMO.CAMP ? ' (practice)' : '') + '</option>'; }).join('') + '</select>' : '') +
      '<span>' + esc(S.user.email) + '</span><span class="acct-role">' + (S.demo ? esc(DB.role().label) : S.roles.map(roleLabel).join(', ')) + '</span></div>' +
      '<nav aria-label="Sections">' + (groups.length > 1 ? groups.map(function (g) { return '<div class="grp">' + esc(g.name) + '</div>' + g.pages.map(link).join(''); }).join('') : pages.map(link).join('')) + '</nav>' +
      '<div class="drawer-foot"><button class="small" id="out">Sign out</button><div class="foot-brand"><span class="logo" role="img" aria-label="Camp Roster by W Group"></span><span class="small muted">Camp Roster by W Group</span></div></div>';
    $drawer.hidden = false;
    document.body.classList.add('side');
    // Phones: the first three pages this person can open, as a bar at the bottom.
    var quick = pages.slice(0, 3);
    $bot.innerHTML = quick.map(function (p) { return '<a href="#' + p[0] + '" data-p="' + p[0] + '">' + svg(ICON[p[0]]) + '<span>' + p[1] + '</span></a>'; }).join('');
    $bot.hidden = quick.length < 2;
    document.body.classList.toggle('has-bot', quick.length >= 2);
    syncSide();
    document.getElementById('out').onclick = function () { DEMO.clear(S.user.email); sb.auth.signOut().then(function () { location.hash = ''; showSignIn(); }); };
    var bar = document.getElementById('demobar');
    if (S.demo) {
      var mine = S.access.filter(function (a) { return a.camp_id !== DEMO.CAMP; });
      bar.hidden = false;
      var cur = DB.role();
      bar.innerHTML = '<div class="in"><span><strong>You\'re in ' + DEMO.NAME + ', a practice camp.</strong> Try anything: your changes stay only while you\'re here, and are wiped when you leave. No emails are sent and nothing reaches families.</span>' +
        '<span class="row"><label class="viewas">Viewing as <select id="demorole">' + DB.roles().map(function (r) { return '<option value="' + r.key + '"' + (r.key === cur.key ? ' selected' : '') + '>' + esc(r.label) + '</option>'; }).join('') + '</select></label>' +
        '<button id="demoreset">Start over</button>' + (mine.length ? '<button class="primary" id="demoleave">Go to my camp</button>' : '') + '</span></div>';
      document.getElementById('demorole').onchange = function (e) {
        var r = DB.setRole(e.target.value);
        location.hash = '';
        pickCamp(DEMO.CAMP);
        toast(r.role === 'director' ? 'Back to director: full access.' : 'Now viewing as ' + r.label.toLowerCase() + '. You see only what they would.');
      };
      document.getElementById('demoreset').onclick = function () { if (!confirm('Start ' + DEMO.NAME + ' over? Your practice changes will be wiped.')) return; DEMO.clear(S.user.email); pickCamp(DEMO.CAMP); toast(DEMO.NAME + ' is fresh again'); };
      var lv = document.getElementById('demoleave'); if (lv) lv.onclick = function () { location.hash = ''; pickCamp(mine[0].camp_id); };
    } else { bar.hidden = true; bar.innerHTML = ''; }
    var cs = document.getElementById('campsel'); if (cs) cs.onchange = function () { pickCamp(cs.value); };
  }

  function route() {
    if (!S.camp) return;
    var h = location.hash.slice(1).split('/');
    var allowed = allowedPages();
    var page = h[0] || (allowed[0] && allowed[0][0]);
    if (page === 'camper' && can('roster')) return camperPage(h[1]);
    if (page === 'reports' && h[1] && can('reports')) { markPage('reports', 'Report'); return reportsPage(h[1]); }
    if (page === 'settings' && h[1] === 'access' && isDirector()) { markPage('settings', 'Who can see what'); return accessPage(); }
    if (!allowed.some(function (p) { return p[0] === page; })) page = allowed[0] ? allowed[0][0] : null;
    markPage(page);
    if (!page) { $main.innerHTML = '<div class="card">Nothing to show for your role yet.</div>'; return; }
    ({ roster: rosterPage, forms: formsPage, bunks: bunksPage, mybunk: myBunkPage, money: moneyPage, imports: importsPage, reports: reportsPage, requests: requestsPage, settings: settingsPage, activity: activityPage })[page]();
  }
  // Highlights the current page in the menu and bottom bar, and shows its name in the top bar.
  function markPage(page, title) {
    [].forEach.call(document.querySelectorAll('#drawer nav a, #botbar a'), function (a) { a.classList.toggle('on', a.dataset.p === page); if (a.dataset.p === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var p = PAGES.find(function (x) { return x[0] === page; });
    document.getElementById('pageTitle').textContent = title || (p ? p[1] : '');
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', function (e) { if (e.target.closest('[data-print]')) window.print(); });

  // ---------- Roster: every camper, any column, filter, sort, export ----------
  var ROSTER_COLS = [
    ['last', 'Last name', function (r) { return r.last_name; }],
    ['first', 'First name', function (r) { return r.first_name; }],
    ['grade', 'Grade', function (r) { return r.grade; }, 'grade'],
    ['age', 'Age', function (r) { return r.age; }, 'num'],
    ['dob', 'Date of birth', function (r) { return r.date_of_birth; }],
    ['gender', 'Gender', function (r) { return r.gender; }],
    ['sessions', 'Sessions', function (r) { return r.sessions.join(', '); }],
    ['bunks', 'Bunk', function (r) { return r.bunks.join(', '); }],
    ['alert', 'Medical alert', function (r) { return r.alert; }],
    ['forms', 'Forms missing', function (r) { return r.missing; }, 'num'],
    ['legal', 'Legal name', function (r) { return (r.legal_first || r.legal_last) ? [r.legal_first || r.first_name, r.legal_last || r.last_name].join(' ') : ''; }],
    ['hebrew', 'Hebrew name', function (r) { return r.hebrew_name; }],
    ['staffchild', 'Staff child', function (r) { return r.staff_child ? 'Yes' : ''; }],
    ['father', 'Father', function (r) { return r.f && r.f.father_first ? r.f.father_first + ' ' + r.f.last_name : ''; }],
    ['fphone', 'Father phone', function (r) { return r.f && r.f.father_phone; }],
    ['femail', 'Father email', function (r) { return r.f && r.f.father_email; }],
    ['mother', 'Mother', function (r) { return r.f && r.f.mother_first ? r.f.mother_first + ' ' + r.f.last_name : ''; }],
    ['mphone', 'Mother phone', function (r) { return r.f && r.f.mother_phone; }],
    ['memail', 'Mother email', function (r) { return r.f && r.f.mother_email; }],
    ['address', 'Address', function (r) { return r.f ? [r.f.address, r.f.city, r.f.state, r.f.zip].filter(Boolean).join(', ') : ''; }],
    ['city', 'City', function (r) { return r.f && r.f.city; }],
    ['emergency', 'Emergency contacts', function (r) { return r.f && (r.f.emergency_contacts || []).join('; '); }],
    ['camperid', 'Camp Flow camper ID', function (r) { return (r.external_id || '').replace(/^campflow:camper:/, ''); }, 'num'],
    ['familyid', 'Camp Flow family ID', function (r) { return r.f ? r.f.external_id.replace(/^campflow:/, '') : ''; }, 'num']
  ];
  var ROSTER_DEFAULT = ['last', 'first', 'grade', 'age', 'sessions', 'bunks', 'alert', 'father', 'fphone', 'mother', 'mphone'];
  var gradeRank = function (g) { var m = String(g || '').match(/\d+/); if (m) return +m[0]; return /^k/i.test(g || '') ? 0 : /pre/i.test(g || '') ? -1 : 99; };

  function loadRoster(force) {
    if (S.roster && !force) return Promise.resolve(S.roster);
    var sel = 'id, external_id, first_name, last_name, legal_first, legal_last, hebrew_name, date_of_birth, gender, grade, staff_child, family_id, ' +
      'families(external_id, last_name, father_first, mother_first, father_phone, mother_phone, father_email, mother_email, address, city, state, zip, emergency_contacts), ' +
      'enrollments(sessions(name)), bunk_assignments(bunks(name))';
    var paged = function (q) {
      var out = [];
      var page = function (n) { return q().range(n * 1000, n * 1000 + 999).then(function (r) { var rows = must(r); out = out.concat(rows); return rows.length === 1000 ? page(n + 1) : out; }); };
      return page(0);
    };
    var status = can('form_status') ? loadStatus().catch(function () { return []; }) : Promise.resolve([]);
    var alerts = can('alerts') ? DB.rpc('camper_alerts', { p_camp: S.camp.id }).then(must).catch(function () { return []; }) : Promise.resolve([]);
    var fields = S.items.some(function (i) { return i.kind === 'field' && can(i.key); }) ? paged(function () { return DB.from('camper_fields').select('camper_id, item_key, value').eq('camp_id', S.camp.id); }).catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([paged(function () { return DB.from('campers').select(sel).eq('camp_id', S.camp.id).eq('active', true).order('last_name').order('first_name'); }), status, alerts, fields]).then(function (x) {
      var miss = {}; (x[1] || []).forEach(function (s) { miss[s.camper_id] = s.missing; });
      var al = {}; (x[2] || []).forEach(function (a) { al[a.camper_id] = a.alert; });
      var fv = {}; (x[3] || []).forEach(function (f) { (fv[f.camper_id] = fv[f.camper_id] || {})[f.item_key] = f.value; });
      var today = new Date();
      S.roster = x[0].map(function (c) {
        var dob = c.date_of_birth ? new Date(c.date_of_birth + 'T12:00:00') : null, age = '';
        if (dob) { age = today.getFullYear() - dob.getFullYear(); if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--; }
        return Object.assign({}, c, { f: c.families, age: age, fields: fv[c.id] || {},
          sessions: (c.enrollments || []).map(function (e) { return e.sessions && e.sessions.name; }).filter(Boolean),
          bunks: (c.bunk_assignments || []).map(function (b) { return b.bunks && b.bunks.name; }).filter(Boolean),
          alert: al[c.id] || '', missing: c.id in miss ? miss[c.id] : '' });
      });
      return S.roster;
    });
  }

  function rosterPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    loadRoster(true).then(drawRoster).catch(fail);
  }

  // Built-in columns plus the camp's custom details (Settings → Who can see what) this person may see.
  function rosterCols() {
    return ROSTER_COLS.concat((S.items || []).filter(function (i) { return i.kind === 'field' && can(i.key); }).map(function (i) {
      return ['f_' + i.key, i.label, function (r) { return r.fields[i.key]; }];
    }));
  }

  function drawRoster() {
    var ALL = rosterCols();
    var R = S.rf || (S.rf = { q: '', session: [], bunk: [], grade: [], gender: [], sort: 'last', dir: 1 });
    var saved; try { saved = JSON.parse(localStorage.getItem('rosterCols') || 'null'); } catch (e) { saved = null; }
    var cols = ALL.filter(function (c) { return (saved || ROSTER_DEFAULT).indexOf(c[0]) >= 0; });
    // Columns a role can't see stay empty; hide them rather than show blanks.
    var anyVal = function (key) { var c = ALL.find(function (x) { return x[0] === key; }); return S.roster.some(function (r) { var v = c[2](r); return v !== '' && v != null; }); };
    if (S.roster.length) { var shown = cols.filter(function (c) { return anyVal(c[0]); }); if (shown.length) cols = shown; }
    var all = S.roster;
    var uniq = function (fn) { var seen = {}; all.forEach(function (r) { [].concat(fn(r)).forEach(function (v) { if (v) seen[v] = 1; }); }); return Object.keys(seen); };
    var opts = {
      session: uniq(function (r) { return r.sessions; }).sort(),
      bunk: uniq(function (r) { return r.bunks.length ? r.bunks : ['(no bunk)']; }).sort(),
      grade: uniq(function (r) { return r.grade || '(none)'; }).sort(function (a, b) { return gradeRank(a) - gradeRank(b) || a.localeCompare(b); }),
      gender: uniq(function (r) { return r.gender || '(none)'; }).sort()
    };
    var q = R.q.toLowerCase();
    var rows = all.filter(function (r) {
      if (q && (r.first_name + ' ' + r.last_name + ' ' + (r.hebrew_name || '') + ' ' + (r.f ? [r.f.father_first, r.f.mother_first, r.f.father_phone, r.f.mother_phone, r.f.father_email, r.f.mother_email].join(' ') : '')).toLowerCase().indexOf(q) < 0) return false;
      if (R.session.length && !r.sessions.some(function (s) { return R.session.indexOf(s) >= 0; })) return false;
      if (R.bunk.length && !(r.bunks.length ? r.bunks : ['(no bunk)']).some(function (b) { return R.bunk.indexOf(b) >= 0; })) return false;
      if (R.grade.length && R.grade.indexOf(r.grade || '(none)') < 0) return false;
      if (R.gender.length && R.gender.indexOf(r.gender || '(none)') < 0) return false;
      return true;
    });
    var sc = ALL.find(function (c) { return c[0] === R.sort; }) || ALL[0];
    rows.sort(function (a, b) {
      var x = sc[2](a), y = sc[2](b), d;
      if (sc[3] === 'grade') d = gradeRank(x) - gradeRank(y) || String(x || '').localeCompare(String(y || ''));
      else if (sc[3] === 'num') d = (x === '' || x == null ? Infinity : +x) - (y === '' || y == null ? Infinity : +y);
      else d = String(x || '').localeCompare(String(y || ''), undefined, { numeric: true, sensitivity: 'base' });
      if ((x === '' || x == null) !== (y === '' || y == null)) return (x === '' || x == null) ? 1 : -1;
      return d * R.dir || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
    });
    var multi = function (key, label) {
      var chosen = R[key];
      return '<details class="msel"><summary>' + label + (chosen.length ? ': <strong>' + esc(chosen.length === 1 ? chosen[0] : chosen.length + ' chosen') + '</strong>' : ': all') + '</summary><div class="msel-box">' +
        opts[key].map(function (o) { return '<label class="check" style="margin:4px 0"><input type="checkbox" data-f="' + key + '" value="' + esc(o) + '"' + (chosen.indexOf(o) >= 0 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>'; }).join('') +
        (opts[key].length ? '' : '<span class="muted small">None yet</span>') + '</div></details>';
    };
    var html = '<div class="row" style="justify-content:space-between"><h1 style="margin:0">Roster</h1><span class="row noprint"><button id="rcsv">Export these ' + rows.length + '</button><button data-print>Print</button></span></div>' +
      '<div class="filters noprint" style="margin-top:12px"><label>Search<input type="search" id="rq" value="' + esc(R.q) + '" placeholder="Name, parent, phone or email"></label>' +
      multi('session', 'Session') + multi('bunk', 'Bunk') + multi('grade', 'Grade') + multi('gender', 'Gender') +
      (R.session.length + R.bunk.length + R.grade.length + R.gender.length + (R.q ? 1 : 0) ? '<button id="rclear">Clear filters</button>' : '') +
      '<details class="msel" style="margin-left:auto"><summary>Columns</summary><div class="msel-box">' +
      ALL.filter(function (c) { return anyVal(c[0]) || cols.indexOf(c) >= 0; }).map(function (c) { return '<label class="check" style="margin:4px 0"><input type="checkbox" data-col="' + c[0] + '"' + (cols.indexOf(c) >= 0 ? ' checked' : '') + '><span>' + esc(c[1]) + '</span></label>'; }).join('') +
      '<button id="rcolreset" class="small" style="margin-top:6px">Reset columns</button></div></details></div>';
    html += '<p class="small muted">' + rows.length + ' of ' + all.length + ' campers · click a column heading to sort</p>';
    html += '<div class="wrap"><table class="grid"><thead><tr>' + cols.map(function (c) {
      var on = c[0] === R.sort;
      return '<th aria-sort="' + (on ? (R.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button class="sortbtn" data-sort="' + c[0] + '">' + esc(c[1]) + (on ? (R.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr></thead><tbody>';
    var canOpen = can('roster');
    rows.forEach(function (r) {
      html += '<tr' + (canOpen ? ' class="click" data-id="' + r.id + '" tabindex="0"' : '') + '>' + cols.map(function (c) {
        var v = c[2](r);
        if (c[0] === 'alert' && v) return '<td><strong style="color:var(--bad-ink)">' + esc(v) + '</strong></td>';
        if ((c[0] === 'fphone' || c[0] === 'mphone') && v) return '<td style="white-space:nowrap"><a href="tel:' + esc(String(v).replace(/[^\d+]/g, '')) + '">' + esc(v) + '</a></td>';
        return '<td>' + esc(v == null ? '' : v) + '</td>';
      }).join('') + '</tr>';
    });
    if (!rows.length) html += '<tr><td colspan="' + cols.length + '" class="muted">' + (all.length ? 'No campers match these filters.' : 'No campers yet. They come from the Camp Flow reports.') + '</td></tr>';
    html += '</tbody></table></div>';
    $main.innerHTML = html;

    var open = $main.querySelector('details.msel[data-open]');
    var redraw = function (keep) { var o = keep && document.activeElement && document.activeElement.closest && document.activeElement.closest('details.msel'); var idx = o ? [].indexOf.call($main.querySelectorAll('details.msel'), o) : -1; drawRoster(); if (idx >= 0) { var d = $main.querySelectorAll('details.msel')[idx]; d.open = true; } };
    var rq = document.getElementById('rq');
    rq.oninput = function () { R.q = rq.value; drawRoster(); var n = document.getElementById('rq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    [].forEach.call($main.querySelectorAll('[data-f]'), function (cb) {
      cb.onchange = function () { var k = cb.dataset.f, v = cb.value; R[k] = cb.checked ? R[k].concat([v]) : R[k].filter(function (x) { return x !== v; }); redraw(true); var b = $main.querySelector('[data-f="' + k + '"][value="' + CSS.escape(v) + '"]'); if (b) b.focus(); };
    });
    [].forEach.call($main.querySelectorAll('[data-col]'), function (cb) {
      cb.onchange = function () {
        var keys = [].map.call($main.querySelectorAll('[data-col]:checked'), function (x) { return x.dataset.col; });
        if (!keys.length) return toast('Keep at least one column.');
        localStorage.setItem('rosterCols', JSON.stringify(keys)); redraw(true); var b = $main.querySelector('[data-col="' + cb.dataset.col + '"]'); if (b) b.focus();
      };
    });
    var cr = document.getElementById('rcolreset'); cr.onclick = function () { localStorage.removeItem('rosterCols'); drawRoster(); };
    var cl = document.getElementById('rclear'); if (cl) cl.onclick = function () { S.rf = null; drawRoster(); };
    [].forEach.call($main.querySelectorAll('[data-sort]'), function (b) {
      b.onclick = function () { if (R.sort === b.dataset.sort) R.dir = -R.dir; else { R.sort = b.dataset.sort; R.dir = 1; } drawRoster(); var n = $main.querySelector('[data-sort="' + b.dataset.sort + '"]'); if (n) n.focus(); };
    });
    [].forEach.call($main.querySelectorAll('tr.click'), function (tr) {
      tr.onclick = function (e) { if (e.target.closest('a')) return; location.hash = 'camper/' + tr.dataset.id; };
      tr.onkeydown = function (e) { if (e.key === 'Enter') location.hash = 'camper/' + tr.dataset.id; };
    });
    document.getElementById('rcsv').onclick = function () {
      var qv = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = [cols.map(function (c) { return qv(c[1]); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return qv(c[2](r)); }).join(','); }));
      var label = [].concat(R.session, R.bunk, R.grade, R.gender).join('-').replace(/[^A-Za-z0-9-]+/g, '_').slice(0, 60);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
      a.download = 'roster' + (label ? '-' + label : '') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    };
  }

  // ---------- Forms dashboard ----------
  function loadStatus(force) {
    if (S.status && !force) return Promise.resolve(S.status);
    return DB.rpc('form_status', { p_camp: S.camp.id }).then(function (r) { S.status = must(r); return S.status; });
  }
  var activeReqs = function () { return S.reqs.filter(function (r) { return r.active; }); };

  function filtered() {
    var f = S.filters, q = f.q.toLowerCase();
    var rows = S.status.filter(function (r) {
      if (q && (r.first_name + ' ' + r.last_name + ' ' + r.family_name).toLowerCase().indexOf(q) < 0) return false;
      if (f.session && (r.sessions || []).indexOf(f.session) < 0) return false;
      if (f.missing === 'any' && !r.missing) return false;
      if (f.missing === 'complete' && r.missing) return false;
      if (f.missing && f.missing !== 'any' && f.missing !== 'complete') { var s = r.statuses[f.missing]; if (s !== 'missing' && s !== 'rejected') return false; }
      if (f.review && r.statuses[f.review] !== 'received') return false;
      return true;
    });
    if (f.sort === 'missing') rows.sort(function (a, b) { return b.missing - a.missing || a.family_name.localeCompare(b.family_name); });
    return rows;
  }

  function formsPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    loadStatus().then(drawForms).catch(fail);
  }
  function drawForms() {
    var all = S.status, reqs = activeReqs(), f = S.filters;
    var complete = all.filter(function (r) { return !r.missing; }).length;
    var html = '<div class="tiles">' +
      '<button class="tile' + (!f.missing ? ' on' : '') + '" data-miss=""><b>' + all.length + '</b><span>Campers</span></button>' +
      '<button class="tile' + (f.missing === 'complete' ? ' on' : '') + '" data-miss="complete"><b>' + complete + '</b><span>All forms in</span></button>' +
      '<button class="tile' + (f.missing === 'any' ? ' on' : '') + '" data-miss="any"><b>' + (all.length - complete) + '</b><span>Missing something</span></button>';
    reqs.forEach(function (r) {
      var n = all.filter(function (x) { var s = x.statuses[r.key]; return s === 'missing' || s === 'rejected'; }).length;
      html += '<button class="tile' + (f.missing === r.key ? ' on' : '') + '" data-miss="' + esc(r.key) + '"><b>' + n + '</b><span>' + esc(r.label) + ' missing</span></button>';
    });
    html += '</div>';
    if (can('health_forms', 'change')) {
      var toReview = reqs.filter(function (r) { return r.kind !== 'sfsp' && r.kind !== 'consent'; }).map(function (r) { return [r, all.filter(function (x) { return x.statuses[r.key] === 'received'; }).length]; }).filter(function (p) { return p[1]; });
      if (toReview.length) html += '<div class="card"><strong>To review:</strong> ' + toReview.map(function (p) { return '<button data-review="' + esc(p[0].key) + '">' + esc(p[0].label) + ' (' + p[1] + ')</button>'; }).join(' ') + (f.review ? ' <button data-review="">Show all</button>' : '') + '</div>';
    }
    html += '<div class="filters"><label>Search<input type="search" id="q" value="' + esc(f.q) + '" placeholder="Camper or family name"></label>' +
      '<label>Session<select id="fs"><option value="">All sessions</option>' + S.sessions.map(function (s) { return '<option' + (f.session === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Show<select id="fm"><option value="">Everyone</option><option value="any"' + (f.missing === 'any' ? ' selected' : '') + '>Missing anything</option><option value="complete"' + (f.missing === 'complete' ? ' selected' : '') + '>All forms in</option>' +
      reqs.map(function (r) { return '<option value="' + esc(r.key) + '"' + (f.missing === r.key ? ' selected' : '') + '>' + esc(r.label) + ' missing</option>'; }).join('') + '</select></label>' +
      '<label>Sort<select id="so"><option value="name">By family name</option><option value="missing"' + (f.sort === 'missing' ? ' selected' : '') + '>Most missing first</option></select></label>' +
      '<span class="row" style="margin-left:auto"><button id="csv">Export list</button>' + (can('form_status', 'change') ? '<button class="primary" id="remind">Send reminders to these families</button>' : '') + '</span></div>';
    var rows = filtered();
    html += '<p class="small muted" id="count">' + rows.length + ' camper' + (rows.length === 1 ? '' : 's') + '</p>';
    html += '<div class="wrap"><table class="grid"><thead><tr><th>Camper</th><th>Family</th><th>Session</th>' + reqs.map(function (r) { return '<th>' + esc(r.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr class="click" data-id="' + r.camper_id + '" tabindex="0"><td><strong>' + esc(r.first_name + ' ' + r.last_name) + '</strong>' + (r.grade ? '<div class="small muted">' + esc(r.grade) + '</div>' : '') + '</td><td>' + esc(r.family_name) +
        (r.paused_until ? '<div class="small muted">Reminders paused</div>' : '') + '</td><td class="small">' + esc((r.sessions || []).join(', ')) + (r.bunks && r.bunks.length ? '<div class="muted">' + esc(r.bunks.join(', ')) + '</div>' : '') + '</td>' +
        reqs.map(function (q) { return '<td>' + chip(r.statuses[q.key]) + '</td>'; }).join('') + '</tr>';
    });
    if (!rows.length) html += '<tr><td colspan="' + (3 + reqs.length) + '" class="muted">No campers match.</td></tr>';
    html += '</tbody></table></div>';
    $main.innerHTML = html;

    var redraw = function () { drawForms(); var q = document.getElementById('q'); if (document.activeElement !== q && S._qFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } };
    document.getElementById('q').oninput = function (e) { S.filters.q = e.target.value; S._qFocus = true; redraw(); };
    document.getElementById('q').onblur = function () { S._qFocus = false; };
    document.getElementById('fs').onchange = function (e) { S.filters.session = e.target.value; redraw(); };
    document.getElementById('fm').onchange = function (e) { S.filters.missing = e.target.value; redraw(); };
    document.getElementById('so').onchange = function (e) { S.filters.sort = e.target.value; redraw(); };
    [].forEach.call($main.querySelectorAll('[data-miss]'), function (b) { b.onclick = function () { S.filters.missing = b.dataset.miss; redraw(); }; });
    [].forEach.call($main.querySelectorAll('[data-review]'), function (b) { b.onclick = function () { S.filters.review = b.dataset.review; redraw(); }; });
    [].forEach.call($main.querySelectorAll('tr.click'), function (tr) {
      tr.onclick = function () { location.hash = 'camper/' + tr.dataset.id; };
      tr.onkeydown = function (e) { if (e.key === 'Enter') location.hash = 'camper/' + tr.dataset.id; };
    });
    document.getElementById('csv').onclick = function () { exportCsv(rows, reqs); };
    var rb = document.getElementById('remind');
    if (rb) rb.onclick = function () {
      var fams = []; rows.forEach(function (r) { if (r.missing && fams.indexOf(r.family_id) < 0) fams.push(r.family_id); });
      if (!fams.length) return toast('Nobody in this list is missing anything.');
      if (!confirm('Email a reminder now to ' + fams.length + ' famil' + (fams.length === 1 ? 'y' : 'ies') + ' in this list? Families with paused reminders are skipped.')) return;
      rb.disabled = true;
      fn('notify', { camp: S.camp.id, action: 'remind', family_ids: fams }).then(function (r) { toast('Sent ' + r.sent + ', skipped ' + r.skipped + (r.failed ? ', failed ' + r.failed : '')); rb.disabled = false; }).catch(function (e) { rb.disabled = false; fail(e); });
    };
  }

  function exportCsv(rows, reqs) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['First name', 'Last name', 'Family', 'Grade', 'Sessions', 'Bunks'].concat(reqs.map(function (r) { return r.label; })).concat(['Missing']).map(q).join(',')];
    rows.forEach(function (r) {
      lines.push([r.first_name, r.last_name, r.family_name, r.grade, (r.sessions || []).join('; '), (r.bunks || []).join('; ')].concat(reqs.map(function (x) { return (STATUS[r.statuses[x.key]] || [, r.statuses[x.key]])[1]; })).concat([r.missing]).map(q).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'forms-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  }

  // ---------- Camper record ----------
  function camperPage(id) {
    markPage('forms', 'Camper');
    $main.innerHTML = '<p class="muted">Loading…</p>';
    DB.from('campers').select('*').eq('id', id).eq('camp_id', S.camp.id).maybeSingle().then(function (r) {
      var c = r.error ? null : r.data;
      if (!c) { $main.innerHTML = '<div class="card"><h2 style="margin-top:0">Camper not found</h2><p>This camper isn\'t in ' + esc(S.camp.name) + '. They may be in another camp, or no longer registered.</p><p><a href="#roster">Back to the roster</a></p></div>'; return; }
      var none = Promise.resolve({ data: null });
      return Promise.all([
        can('parent_contacts') ? DB.from('families').select('*').eq('id', c.family_id).maybeSingle() : none,
        can('health_forms') ? DB.from('submissions').select('*').eq('family_id', c.family_id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
        can('health_forms') ? DB.from('camper_health').select('*').eq('camper_id', id).maybeSingle() : none,
        DB.from('campers').select('id, first_name, last_name, active').eq('family_id', c.family_id).eq('active', true),
        can('form_status') ? loadStatus() : Promise.resolve([]),
        can('form_status') ? DB.from('reminder_log').select('*').eq('family_id', c.family_id).order('sent_at', { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
        can('alerts') ? DB.rpc('camper_alerts', { p_camp: S.camp.id }) : Promise.resolve({ data: [] }),
        S.items.some(function (i) { return i.kind === 'field' && can(i.key); }) ? DB.from('camper_fields').select('*').eq('camper_id', id) : Promise.resolve({ data: [] })
      ]).then(function (x) {
        var al = (must(x[6]) || []).find(function (a) { return a.camper_id === id; });
        drawCamper(c, must(x[0]), must(x[1]) || [], must(x[2]), must(x[3]) || [], must(x[5]) || [], al ? al.alert : '', must(x[7]) || []);
      });
    }).catch(fail);
  }

  function answersHtml(req, a) {
    if (!a || !Object.keys(a).length) return '';
    if (req.kind === 'consent') return '<div class="small">Signed by <strong>' + esc(a.signed_name) + '</strong> ' + esc(when(a.signed_at)) + '</div>';
    if (req.kind === 'questionnaire') {
      if (a.has_any === 'no') return '<div class="small">Family answered: no allergies, conditions or medications.</div>';
      var labels = { allergies: 'Allergies', conditions: 'Conditions', medications: 'Medications', diet: 'Diet', other: 'Other' };
      return '<dl class="kv small">' + Object.keys(labels).filter(function (k) { return a[k]; }).map(function (k) { return '<dt>' + labels[k] + '</dt><dd>' + esc(a[k]) + '</dd>'; }).join('') +
        (a.epipen ? '<dt>EpiPen</dt><dd>Yes</dd>' : '') + (a.inhaler ? '<dt>Inhaler</dt><dd>Yes</dd>' : '') + '</dl>';
    }
    var fields = (req.config.fields || []);
    return '<dl class="kv small">' + fields.filter(function (f) { return a[f.key]; }).map(function (f) { return '<dt>' + esc(f.label) + '</dt><dd>' + esc(a[f.key]) + '</dd>'; }).join('') + '</dl>';
  }

  function drawCamper(c, fam, subs, health, siblings, reminders, alertText, fieldRows) {
    var row = (S.status || []).find(function (r) { return r.camper_id === c.id; }) || { statuses: {} };
    var reqs = can('form_status') || can('health_forms') ? activeReqs() : [];
    var parents = fam ? [[fam.father_title, fam.father_first, fam.last_name, fam.father_phone, fam.father_email], [fam.mother_title, fam.mother_first, fam.last_name, fam.mother_phone, fam.mother_email]]
      .filter(function (p) { return p[1]; }) : [];
    var html = '<p class="noprint"><a href="#' + (can('form_status') ? 'forms' : 'roster') + '">← All campers</a></p><h1>' + esc(c.first_name + ' ' + c.last_name) + '</h1>' +
      '<p class="muted">' + [c.grade, c.date_of_birth && 'Born ' + day(c.date_of_birth), (row.sessions || []).join(', '), (row.bunks || []).join(', ')].filter(Boolean).map(esc).join(' · ') +
      (siblings.length > 1 ? ' · Siblings: ' + siblings.filter(function (s) { return s.id !== c.id; }).map(function (s) { return '<a href="#camper/' + s.id + '">' + esc(s.first_name) + '</a>'; }).join(', ') : '') + '</p>';
    html += '<div class="two"><div>';
    reqs.forEach(function (r) {
      var mine = subs.filter(function (s) { return s.requirement_id === r.id && (r.scope === 'family' ? !s.camper_id : s.camper_id === c.id); });
      html += '<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">' + esc(r.label) + (r.scope === 'family' ? ' <span class="small muted">(whole family)</span>' : '') + '</h3>' + (row.statuses[r.key] ? chip(row.statuses[r.key]) : '') + '</div>';
      if (r.kind === 'sfsp') html += '<p class="small muted">Filled in on the SFSP site; checked off automatically when the SFSP app receives it.</p>';
      if (fam && r.kind === 'consent' && r.config.accept_disclosure && String((fam.disclosures || {})[r.config.accept_disclosure] || '').toLowerCase() === 'yes') html += '<p class="small muted">Accepted in Camp Flow registration (' + esc(r.config.accept_disclosure) + ').</p>';
      mine.forEach(function (s) {
        html += '<div class="sub"><div class="row" style="justify-content:space-between"><span class="small">' + esc(when(s.created_at)) + ' · ' + (s.submitted_by === 'family' ? 'from the family' : esc(s.submitted_by)) + '</span>' + chip(s.status) + '</div>' +
          answersHtml(r, s.answers) +
          (s.files || []).map(function (f) { return '<button class="small" data-file="' + esc(f.path) + '" data-sub="' + s.id + '">Open ' + esc(f.name) + '</button> '; }).join('') +
          (s.status === 'rejected' && s.reject_reason ? '<div class="small" style="color:var(--bad-ink)">Reason: ' + esc(s.reject_reason) + '</div>' : '') +
          (s.reviewed_by && s.status !== 'rejected' ? '<div class="small muted">Checked by ' + esc(s.reviewed_by) + '</div>' : '') +
          (can('health_forms', 'change') && s.status === 'received' && s === mine[0] ? '<div class="row noprint" style="margin-top:6px"><button class="primary" data-approve="' + s.id + '">Approve</button><button data-reject="' + s.id + '">Send back to family…</button></div>' : '') +
          '</div>';
      });
      if (r.kind !== 'sfsp' && can('health_forms', 'change')) {
        html += '<details class="noprint" style="margin-top:8px"><summary class="small">Add a paper form</summary><div style="margin-top:8px">' +
          '<input type="file" multiple accept="image/*,application/pdf" data-paper="' + r.id + '"> <button data-paperbtn="' + r.id + '">Save</button></div></details>';
      }
      html += '</div>';
    });
    html += '</div><div>';
    // Health alert
    if (can('alerts')) html += '<div class="card"><h3 style="margin-top:0">Medical alert</h3><p class="small muted">A one-line alert for staff who don\'t see the health forms.</p>' +
      (can('alerts', 'change') ? '<textarea id="alert" aria-label="Medical alert">' + esc(alertText || health && health.alert || '') + '</textarea><div class="row" style="margin-top:6px"><button id="savealert">Save alert</button>' + (health && health.updated_by ? '<span class="small muted">Last changed by ' + esc(health.updated_by) + ' ' + esc(when(health.updated_at)) + '</span>' : '') + '</div>'
        : '<p>' + (alertText ? '<strong style="color:var(--bad-ink)">' + esc(alertText) + '</strong>' : 'None') + '</p>') + '</div>';
    // Names for the SFSP form
    var canName = can('roster', 'change');
    html += '<div class="card"><h3 style="margin-top:0">Names for the SFSP form</h3><p class="small muted">The federal meal form needs legal names (as on the birth certificate). These pre-fill the family\'s SFSP form.</p>' +
      (canName ? '<div class="row"><label class="field" style="flex:1">Legal first name<input type="text" id="lfirst" value="' + esc(c.legal_first || '') + '" placeholder="' + esc(c.first_name) + '"></label><label class="field" style="flex:1">Legal last name<input type="text" id="llast" value="' + esc(c.legal_last || '') + '" placeholder="' + esc(c.last_name) + '"></label></div>' +
        '<label class="field">Hebrew name<input type="text" id="hname" value="' + esc(c.hebrew_name || '') + '"></label><label class="check"><input type="checkbox" id="staffc"' + (c.staff_child ? ' checked' : '') + '><span>Child of a camp staff member</span></label><button id="savenames">Save</button>'
        : '<dl class="kv small"><dt>Legal name</dt><dd>' + esc((c.legal_first || c.first_name) + ' ' + (c.legal_last || c.last_name)) + '</dd><dt>Hebrew name</dt><dd>' + esc(c.hebrew_name || '') + '</dd></dl>') + '</div>';
    // Custom details the director added (Settings → Who can see what)
    var myFields = (S.items || []).filter(function (i) { return i.kind === 'field' && can(i.key); });
    if (myFields.length) {
      var fv = {}; fieldRows.forEach(function (f) { fv[f.item_key] = f.value; });
      html += '<div class="card"><h3 style="margin-top:0">More details</h3>' + myFields.map(function (i) {
        return can(i.key, 'change') ? '<label class="field">' + esc(i.label) + '<input type="text" data-cf="' + esc(i.key) + '" value="' + esc(fv[i.key] || '') + '" maxlength="500"></label>'
          : '<dl class="kv"><dt>' + esc(i.label) + '</dt><dd>' + esc(fv[i.key] || '') + '</dd></dl>';
      }).join('') + (myFields.some(function (i) { return can(i.key, 'change'); }) ? '<button id="savecf">Save</button>' : '') + '</div>';
    }
    // Family
    if (fam) html += '<div class="card"><h3 style="margin-top:0">' + esc(fam.last_name) + ' family</h3><dl class="kv">' +
      parents.map(function (p) { return '<dt>' + esc([p[0], p[1]].filter(Boolean).join(' ')) + '</dt><dd>' + [p[3] && '<a href="tel:' + esc(p[3].replace(/[^\d+]/g, '')) + '">' + esc(p[3]) + '</a>', p[4] && '<a href="mailto:' + esc(p[4]) + '">' + esc(p[4]) + '</a>'].filter(Boolean).join('<br>') + '</dd>'; }).join('') +
      (fam.address ? '<dt>Address</dt><dd>' + esc([fam.address, fam.city, fam.state, fam.zip].filter(Boolean).join(', ')) + '</dd>' : '') +
      (fam.emergency_contacts && fam.emergency_contacts.length ? '<dt>Emergency</dt><dd>' + fam.emergency_contacts.map(esc).join('<br>') + '</dd>' : '') +
      '<dt>Camp Flow</dt><dd><a href="https://app.campflow.org/families/' + esc(fam.external_id.replace(/^campflow:/, '')) + '" target="_blank" rel="noopener">Family #' + esc(fam.external_id.replace(/^campflow:/, '')) + '</a></dd></dl></div>';
    if (can('form_status', 'change') && fam) {
      html += '<div class="card noprint"><h3 style="margin-top:0">Emails to this family</h3>' +
        '<div class="row"><button id="sendnow">Send reminder now</button><button id="copylink">' + (S.demo ? 'Open family page (practice)' : 'Copy family link') + '</button></div>' +
        '<label class="field" style="margin-top:12px">Pause automatic reminders until<input type="date" id="pause" value="' + esc(fam.reminders_paused_until || '') + '"></label>' +
        '<label class="field">Note (for example, "Mother called, sending Friday")<input type="text" id="pnote" value="' + esc(fam.reminder_note || '') + '"></label><button id="savepause">Save</button>' +
        (reminders.length ? '<h4>Sent</h4><ul class="small">' + reminders.map(function (l) { return '<li>' + esc(when(l.sent_at)) + ' · ' + esc(l.kind) + (l.error ? ' · <span style="color:var(--bad-ink)">failed</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="small muted">No emails sent yet.</p>') + '</div>';
    }
    html += '</div></div>';
    $main.innerHTML = html;

    var reload = function () { S.status = null; loadStatus(true).then(function () { camperPage(c.id); }); };
    [].forEach.call($main.querySelectorAll('[data-file]'), function (b) {
      b.onclick = function () {
        var w = window.open('', '_blank');
        DB.rpc('log_file_view', { p_submission: b.dataset.sub, p_path: b.dataset.file })
          .then(function (r) { must(r); return DB.storage.from('forms').createSignedUrl(b.dataset.file, 120); })
          .then(function (r) { w.location = must(r).signedUrl; }).catch(function (e) { w.close(); fail(e); });
      };
    });
    [].forEach.call($main.querySelectorAll('[data-approve]'), function (b) {
      b.onclick = function () { DB.from('submissions').update({ status: 'approved', reviewed_by: S.user.email, reviewed_at: new Date().toISOString() }).eq('id', b.dataset.approve).then(must).then(reload).catch(fail); };
    });
    [].forEach.call($main.querySelectorAll('[data-reject]'), function (b) {
      b.onclick = function () {
        var why = prompt('What should the family fix? They will see this and get an email with their link.', 'The photo is hard to read. Please send a clearer one.');
        if (!why) return;
        DB.from('submissions').update({ status: 'rejected', reject_reason: why, reviewed_by: S.user.email, reviewed_at: new Date().toISOString() }).eq('id', b.dataset.reject).then(must)
          .then(function () { return fn('notify', { camp: S.camp.id, action: 'rejected', family_ids: [c.family_id] }).catch(function () { toast('Saved, but the email did not send.'); }); })
          .then(reload).catch(fail);
      };
    });
    [].forEach.call($main.querySelectorAll('[data-paperbtn]'), function (b) {
      b.onclick = function () {
        var input = $main.querySelector('[data-paper="' + b.dataset.paperbtn + '"]'), files = [].slice.call(input.files);
        if (!files.length) return toast('Choose the scanned or photographed form first.');
        var r = S.reqs.find(function (x) { return x.id === b.dataset.paperbtn; });
        var batch = Date.now().toString(36);
        b.disabled = true;
        Promise.all(files.map(function (f, i) {
          var path = S.camp.id + '/' + c.family_id + '/' + batch + '/' + i + '-' + f.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.');
          return DB.storage.from('forms').upload(path, f, { contentType: f.type }).then(function (res) { must(res); return { path: path, name: f.name, type: f.type, size: f.size }; });
        })).then(function (saved) {
          return DB.from('submissions').insert({ camp_id: S.camp.id, requirement_id: r.id, family_id: c.family_id, camper_id: r.scope === 'camper' ? c.id : null, status: 'received', files: saved, answers: { paper: true }, submitted_by: S.user.email.toLowerCase() });
        }).then(must).then(function () { toast('Paper form saved'); reload(); }).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    var sa = document.getElementById('savealert');
    if (sa) sa.onclick = function () {
      DB.from('camper_health').upsert({ camper_id: c.id, camp_id: S.camp.id, alert: document.getElementById('alert').value.trim() || null, updated_by: S.user.email, updated_at: new Date().toISOString() }).then(must).then(function () { toast('Alert saved'); }).catch(fail);
    };
    var scf = document.getElementById('savecf');
    if (scf) scf.onclick = function () {
      var rows = [].map.call($main.querySelectorAll('[data-cf]'), function (inp) { return { camper_id: c.id, camp_id: S.camp.id, item_key: inp.dataset.cf, value: inp.value.trim() || null, updated_by: S.user.email, updated_at: new Date().toISOString() }; });
      DB.from('camper_fields').upsert(rows, { onConflict: 'camper_id,item_key' }).then(must).then(function () { S.roster = null; toast('Saved'); }).catch(fail);
    };
    var svn = document.getElementById('savenames');
    if (svn) svn.onclick = function () {
      DB.from('campers').update({ legal_first: document.getElementById('lfirst').value.trim() || null, legal_last: document.getElementById('llast').value.trim() || null, hebrew_name: document.getElementById('hname').value.trim() || null, staff_child: document.getElementById('staffc').checked }).eq('id', c.id).then(must).then(function () { toast('Saved'); }).catch(fail);
    };
    var sn = document.getElementById('sendnow');
    if (sn) sn.onclick = function () { sn.disabled = true; fn('notify', { camp: S.camp.id, action: 'remind', family_ids: [c.family_id], force: true }).then(function (r) { toast(r.sent ? 'Reminder sent' : 'Nothing sent: ' + (r.reasons && r.reasons[0] || 'nothing missing')); camperPage(c.id); }).catch(function (e) { sn.disabled = false; fail(e); }); };
    var cl = document.getElementById('copylink');
    if (cl && S.demo) cl.onclick = function () { window.open('/portal.html?demo=' + encodeURIComponent(c.family_id), '_blank'); };
    else if (cl) cl.onclick = function () { fn('notify', { camp: S.camp.id, action: 'link', family_ids: [c.family_id] }).then(function (r) { return navigator.clipboard.writeText(r.link).then(function () { toast('Link copied. It opens this family\'s forms; share it only with them.'); }, function () { prompt('Family link:', r.link); }); }).catch(fail); };
    var sp = document.getElementById('savepause');
    if (sp) sp.onclick = function () { DB.from('families').update({ reminders_paused_until: document.getElementById('pause').value || null, reminder_note: document.getElementById('pnote').value.trim() || null }).eq('id', c.family_id).then(must).then(function () { toast('Saved'); S.status = null; }).catch(fail); };
  }

  // ---------- Bunks ----------
  function bunksPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    var scoped = S.perms.roles.filter(function (r) { return r.scope === 'session'; });
    var campWide = isDirector() || S.perms.roles.some(function (r) { return r.scope === 'camp'; }) || scoped.some(function (r) { return !r.session_id; });
    var sessions = campWide ? S.sessions : S.sessions.filter(function (s) { return scoped.some(function (r) { return r.session_id === s.id; }); });
    if (!sessions.length) { $main.innerHTML = '<div class="card"><h2>Bunks</h2><p>No sessions yet. They are created automatically from the Camp Flow camper report' + (isDirector() ? ', or you can add one in Settings' : '') + '.</p></div>'; return; }
    S.bunkSession = S.bunkSession && sessions.some(function (s) { return s.id === S.bunkSession; }) ? S.bunkSession : sessions[0].id;
    var canEdit = can('bunks', 'change');
    Promise.all([
      DB.from('bunks').select('*').eq('session_id', S.bunkSession).order('sort').order('name'),
      DB.from('enrollments').select('camper_id, campers(id, first_name, last_name, grade, active)').eq('session_id', S.bunkSession),
      DB.from('bunk_assignments').select('bunk_id, camper_id, bunks!inner(session_id)').eq('bunks.session_id', S.bunkSession)
    ]).then(function (r) {
      var bunks = must(r[0]), enrolled = must(r[1]).map(function (e) { return e.campers; }).filter(function (c) { return c && c.active; }), asg = must(r[2]);
      enrolled.sort(function (a, b) { return (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name); });
      S.bunkSel = S.bunkSel && bunks.some(function (b) { return b.id === S.bunkSel; }) ? S.bunkSel : (bunks[0] && bunks[0].id);
      var placed = {}; asg.forEach(function (a) { placed[a.camper_id] = a.bunk_id; });
      var html = '<div class="row noprint" style="justify-content:space-between"><h1 style="margin:0">Bunks</h1><label class="small">Session <select id="bs" style="width:auto">' + sessions.map(function (s) { return '<option value="' + s.id + '"' + (s.id === S.bunkSession ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label></div>';
      html += '<div class="bunkcols" style="margin-top:12px"><div class="card list noprint">' + bunks.map(function (b) {
        var n = asg.filter(function (a) { return a.bunk_id === b.id; }).length;
        return '<button class="item' + (b.id === S.bunkSel ? ' on' : '') + '" data-b="' + b.id + '"><span>' + esc(b.name) + '</span><span class="muted">' + n + '</span></button>';
      }).join('') + (canEdit ? '<form id="nb" class="row" style="margin-top:10px"><input type="text" id="nbn" placeholder="New bunk name" aria-label="New bunk name" style="flex:1"><button>Add</button></form>' : '') +
        '<p class="small muted">' + enrolled.filter(function (c) { return !placed[c.id]; }).length + ' of ' + enrolled.length + ' campers not in a bunk</p></div><div id="bunkbody"></div></div>';
      $main.innerHTML = html;
      document.getElementById('bs').onchange = function (e) { S.bunkSession = e.target.value; S.bunkSel = null; bunksPage(); };
      [].forEach.call($main.querySelectorAll('[data-b]'), function (b) { b.onclick = function () { S.bunkSel = b.dataset.b; bunksPage(); }; });
      var nb = document.getElementById('nb');
      if (nb) nb.onsubmit = function (e) {
        e.preventDefault(); var name = document.getElementById('nbn').value.trim(); if (!name) return;
        DB.from('bunks').insert({ camp_id: S.camp.id, session_id: S.bunkSession, name: name, sort: bunks.length }).select().single().then(function (r) { S.bunkSel = must(r).id; bunksPage(); }).catch(fail);
      };
      if (!S.bunkSel) { document.getElementById('bunkbody').innerHTML = '<div class="card">No bunks in this session yet.</div>'; return; }
      DB.rpc('bunk_list', { p_bunk: S.bunkSel }).then(function (r) {
        var list = must(r), bunk = bunks.find(function (b) { return b.id === S.bunkSel; });
        var unplaced = enrolled.filter(function (c) { return !placed[c.id]; });
        var h = '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">' + esc(bunk.name) + ' <span class="muted small">' + list.length + ' campers</span></h2><button class="noprint" data-print>Print</button></div>' +
          '<table class="grid" style="margin-top:10px"><thead><tr><th>Camper</th><th>Grade</th><th>Alert</th>' + (canEdit ? '<th class="noprint"></th>' : '') + '</tr></thead><tbody>' +
          list.map(function (c) { return '<tr><td>' + esc(c.first_name + ' ' + c.last_name) + '</td><td>' + esc(c.grade || '') + '</td><td>' + (c.alert ? '<strong style="color:var(--bad-ink)">' + esc(c.alert) + '</strong>' : '') + '</td>' + (canEdit ? '<td class="noprint"><button data-out="' + c.camper_id + '">Remove</button></td>' : '') + '</tr>'; }).join('') +
          (list.length ? '' : '<tr><td colspan="4" class="muted">No campers yet.</td></tr>') + '</tbody></table></div>';
        if (canEdit) h += '<div class="card noprint"><h3 style="margin-top:0">Add campers</h3>' + (unplaced.length ? '<div class="row">' + unplaced.map(function (c) { return '<label class="check" style="width:230px;margin:2px 0"><input type="checkbox" value="' + c.id + '" class="addc"><span>' + esc(c.first_name + ' ' + c.last_name) + (c.grade ? ' <span class="muted small">' + esc(c.grade) + '</span>' : '') + '</span></label>'; }).join('') + '</div><button class="primary" id="addsel" style="margin-top:8px">Add to ' + esc(bunk.name) + '</button>' : '<p class="muted">Everyone in this session is in a bunk.</p>') + '</div>';
        document.getElementById('bunkbody').innerHTML = h;
        [].forEach.call($main.querySelectorAll('[data-out]'), function (b) { b.onclick = function () { DB.from('bunk_assignments').delete().eq('bunk_id', S.bunkSel).eq('camper_id', b.dataset.out).then(must).then(bunksPage).catch(fail); }; });
        var add = document.getElementById('addsel');
        if (add) add.onclick = function () {
          var ids = [].map.call($main.querySelectorAll('.addc:checked'), function (i) { return i.value; });
          if (!ids.length) return toast('Tick the campers to add.');
          DB.from('bunk_assignments').insert(ids.map(function (id) { return { bunk_id: S.bunkSel, camper_id: id, camp_id: S.camp.id, assigned_by: S.user.email }; })).then(must).then(bunksPage).catch(fail);
        };
      }).catch(fail);
    }).catch(fail);
  }

  function myBunkPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all(S.myBunks.map(function (id) { return Promise.all([DB.from('bunks').select('name').eq('id', id).single(), DB.rpc('bunk_list', { p_bunk: id })]); })).then(function (all) {
      $main.innerHTML = all.map(function (x) {
        var b = must(x[0]), list = must(x[1]);
        return '<div class="card"><div class="row" style="justify-content:space-between"><h1 style="margin:0">' + esc(b.name) + '</h1><button class="noprint" data-print>Print</button></div><p class="muted">' + list.length + ' campers</p>' +
          '<table class="grid"><thead><tr><th>Camper</th><th>Grade</th><th>Alert</th></tr></thead><tbody>' + list.map(function (c) { return '<tr><td>' + esc(c.first_name + ' ' + c.last_name) + '</td><td>' + esc(c.grade || '') + '</td><td>' + (c.alert ? '<strong style="color:var(--bad-ink)">' + esc(c.alert) + '</strong>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }).join('');
    }).catch(fail);
  }

  // ---------- Money (read-only copy of Camp Flow) ----------
  function moneyPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([
      DB.from('finance_accounts').select('*, families(id, last_name, father_first, mother_first, external_id, active)'),
      DB.from('finance_entries').select('*').order('occurred_on', { ascending: false }).limit(2000)
    ]).then(function (r) {
      var acc = must(r[0]).filter(function (a) { return a.families && a.families.active; }), entries = must(r[1]);
      acc.sort(function (a, b) { return a.families.last_name.localeCompare(b.families.last_name); });
      var sum = function (k) { return acc.reduce(function (n, a) { return n + (a[k] || 0); }, 0); };
      var asOf = acc.reduce(function (m, a) { return a.as_of > m ? a.as_of : m; }, '');
      var anyMoney = acc.some(function (a) { return a.total_charges_cents != null || a.balance_cents != null; });
      var html = '<h1>Money</h1><p class="muted">A read-only copy of Camp Flow\'s figures' + (asOf ? ', as of ' + esc(when(asOf)) : '') + '. Payments are still taken in Camp Flow this season.</p>';
      if (!anyMoney) html += '<div class="card">Camp Flow\'s report has no charge or payment figures yet. Check that charges are posted in Camp Flow and that the scheduled report includes the money columns.</div>';
      html += '<div class="tiles"><div class="tile"><b>' + money(sum('total_charges_cents')) + '</b><span>Charged</span></div><div class="tile"><b>' + money(sum('total_payments_cents')) + '</b><span>Paid</span></div><div class="tile"><b>' + money(sum('balance_cents')) + '</b><span>Balance due</span></div><div class="tile"><b>' + entries.length + '</b><span>Transactions on file</span></div></div>';
      html += '<div class="wrap"><table class="grid"><thead><tr><th>Family</th><th class="num">Charged</th><th class="num">Paid</th><th class="num">Balance</th><th>Autopay</th><th>Transactions</th></tr></thead><tbody>' +
        acc.map(function (a) { var n = entries.filter(function (e) { return e.family_id === a.family_id; }).length; return '<tr><td>' + esc(a.families.last_name) + ' <span class="muted small">' + esc([a.families.father_first, a.families.mother_first].filter(Boolean).join(' & ')) + '</span></td><td class="num">' + money(a.total_charges_cents) + '</td><td class="num">' + money(a.total_payments_cents) + '</td><td class="num">' + money(a.balance_cents) + '</td><td class="small">' + esc(a.active_autopay || a.paused_autopay || '') + '</td><td>' + (n ? '<button data-fam="' + a.family_id + '">' + n + '</button>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div><div id="entries"></div>';
      $main.innerHTML = html;
      [].forEach.call($main.querySelectorAll('[data-fam]'), function (b) {
        b.onclick = function () {
          var mine = entries.filter(function (e) { return e.family_id === b.dataset.fam; });
          document.getElementById('entries').innerHTML = '<div class="card" style="margin-top:16px"><h3 style="margin-top:0">Transactions</h3><table class="grid"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>' +
            mine.map(function (e) { return '<tr><td>' + esc(day(e.occurred_on)) + '</td><td>' + esc(e.kind) + '</td><td>' + esc(e.description || '') + '</td><td class="num">' + money(e.amount_cents) + '</td></tr>'; }).join('') + '</tbody></table></div>';
          document.getElementById('entries').scrollIntoView({ behavior: 'smooth' });
        };
      });
    }).catch(fail);
  }

  // ---------- Imports ----------
  function importsPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    DB.from('import_runs').select('*').eq('camp_id', S.camp.id).order('created_at', { ascending: false }).limit(50).then(function (r) {
      var runs = must(r);
      $main.innerHTML = '<h1>Imports</h1><p class="muted">Camp Flow\'s scheduled report emails are imported automatically. To import one by hand, download it from Camp Flow and choose it here.</p>' +
        '<div class="card"><input type="file" id="xf" accept=".xlsx"> <button class="primary" id="xb">Import</button><div id="xr"></div></div>' +
        '<div class="wrap"><table class="grid"><thead><tr><th>When</th><th>Report</th><th>From</th><th>Result</th><th>Notes</th></tr></thead><tbody>' +
        runs.map(function (x) { return '<tr><td>' + esc(when(x.created_at)) + '</td><td>' + esc(x.report) + '</td><td class="small">' + esc(x.via === 'email' ? 'Camp Flow email' : x.via) + '</td><td class="small">' + esc(Object.keys(x.counts).map(function (k) { return k.replace(/_/g, ' ') + ': ' + x.counts[k]; }).join(', ')) + '</td><td class="small">' + (x.problems || []).slice(0, 5).map(function (p) { return esc((p.row ? 'Row ' + p.row + ': ' : '') + (p.camper ? p.camper + ': ' : '') + p.problem); }).join('<br>') + ((x.problems || []).length > 5 ? '<br>…and ' + (x.problems.length - 5) + ' more' : '') + '</td></tr>'; }).join('') +
        (runs.length ? '' : '<tr><td colspan="5" class="muted">No imports yet.</td></tr>') + '</tbody></table></div>';
      document.getElementById('xb').onclick = function () {
        var f = document.getElementById('xf').files[0]; if (!f) return toast('Choose the .xlsx file from Camp Flow first.');
        var b = document.getElementById('xb'); b.disabled = true;
        f.arrayBuffer().then(function (buf) { return fn('import-campflow', buf, { raw: true, query: '?camp=' + S.camp.id + '&name=' + encodeURIComponent(f.name) }); })
          .then(function (res) { S.status = null; toast('Imported the ' + res.report + ' report'); importsPage(); })
          .catch(function (e) { b.disabled = false; fail(e); });
      };
    }).catch(fail);
  }

  // ---------- Who can see what (director) ----------
  var SCOPES = { camp: 'Whole camp', session: 'One session', bunk: 'One bunk' };
  var slug = function (t) { return String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'x'; };

  function accessPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([
      DB.from('roles').select('*').eq('camp_id', S.camp.id).order('sort'),
      DB.from('perm_items').select('*').eq('camp_id', S.camp.id).order('sort'),
      DB.from('permissions').select('*').eq('camp_id', S.camp.id),
      DB.from('staff').select('role').eq('camp_id', S.camp.id)
    ]).then(function (r) {
      var roles = must(r[0]), items = must(r[1]), perms = must(r[2]), staff = must(r[3]);
      S.roleList = roles; S.items = items;
      if (S.demo) { drawTop(); markPage('settings', 'Who can see what'); }   // "Viewing as" lists new roles
      var P = {}; perms.forEach(function (p) { P[p.role_key + '|' + p.item_key] = p; });
      var used = {}; staff.forEach(function (x) { used[x.role] = (used[x.role] || 0) + 1; });
      var html = '<p class="noprint"><a href="#settings">← Settings</a></p><h1>Who can see what</h1>' +
        '<p class="muted" style="max-width:820px">Tick what each role can <strong>see</strong> and <strong>change</strong>. Changes apply as soon as you tick, for everyone with that role. The database enforces this table, so a role can\'t get around it. The Director always has full access, and only directors manage staff access and these settings.</p>' +
        '<div class="wrap"><table class="grid access"><thead><tr><th style="min-width:190px">Role</th>' +
        items.map(function (i) {
          return '<th class="itemh"><span title="' + esc(i.help || '') + '">' + esc(i.label) + '</span>' + (i.kind === 'field' ? ' <button class="linkish" data-rmitem="' + esc(i.key) + '" aria-label="Remove ' + esc(i.label) + '">Remove</button><div class="small muted">Your detail</div>' : (i.help ? '<div class="small muted itemhelp">' + esc(i.help) + '</div>' : '')) + '</th>';
        }).join('') + '</tr></thead><tbody>';
      roles.forEach(function (ro) {
        var dir = ro.key === 'director';
        html += '<tr><th scope="row" class="roleh"><strong>' + esc(ro.label) + '</strong>' +
          (dir ? '<div class="small muted">Whole camp · always full access</div>' :
            '<div class="small"><select data-scope="' + esc(ro.key) + '" aria-label="' + esc(ro.label) + ' is limited to" style="width:auto;padding:3px 6px;font-size:13px">' + Object.keys(SCOPES).map(function (k) { return '<option value="' + k + '"' + (ro.scope === k ? ' selected' : '') + '>' + SCOPES[k] + '</option>'; }).join('') + '</select></div>' +
            '<div class="small muted">' + (used[ro.key] ? used[ro.key] + ' staff' : 'No staff yet') + (used[ro.key] ? '' : ' · <button class="linkish" data-rmrole="' + esc(ro.key) + '">Remove role</button>') + '</div>') + '</th>';
        items.forEach(function (i) {
          var p = P[ro.key + '|' + i.key] || {}, see = dir || p.can_see || p.can_change, ch = dir || p.can_change;
          html += '<td class="cell">' + (dir ? '<span class="chip good">All</span>' :
            '<label class="tick"><input type="checkbox" data-p="see" data-r="' + esc(ro.key) + '" data-i="' + esc(i.key) + '"' + (see ? ' checked' : '') + ' aria-label="' + esc(ro.label) + ' can see ' + esc(i.label) + '">See</label>' +
            '<label class="tick"><input type="checkbox" data-p="change" data-r="' + esc(ro.key) + '" data-i="' + esc(i.key) + '"' + (ch ? ' checked' : '') + ' aria-label="' + esc(ro.label) + ' can change ' + esc(i.label) + '">Change</label>') + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      html += '<div class="two" style="margin-top:16px"><div class="card"><h2 style="margin-top:0">Add a role</h2><p class="small muted">For example Kitchen, Waterfront or Night watch. Then tick what they can see, and give people the role under Staff access.</p>' +
        '<form id="addrole"><label class="field">Role name<input type="text" id="rname" maxlength="60" required></label><label class="field">Limited to<select id="rscope">' +
        Object.keys(SCOPES).map(function (k) { return '<option value="' + k + '">' + SCOPES[k] + (k === 'session' ? ' (set per person)' : k === 'bunk' ? ' (their own bunk)' : '') + '</option>'; }).join('') + '</select></label><button class="primary">Add role</button></form></div>' +
        '<div class="card"><h2 style="margin-top:0">Add a camper detail</h2><p class="small muted">A detail you want to keep for every camper, for example T-shirt size, swim level or bus stop. It appears on the camper page and as a roster column, for the roles you tick.</p>' +
        '<form id="additem"><label class="field">Detail name<input type="text" id="iname" maxlength="80" required></label><button class="primary">Add detail</button></form></div></div>';
      $main.innerHTML = html;

      var setPerm = function (role, item, see, change) {
        return DB.from('permissions').upsert({ camp_id: S.camp.id, role_key: role, item_key: item, can_see: see, can_change: change }, { onConflict: 'camp_id,role_key,item_key' }).then(must);
      };
      [].forEach.call($main.querySelectorAll('input[data-p]'), function (cb) {
        cb.onchange = function () {
          var row = cb.dataset.r, it = cb.dataset.i;
          var seeBox = $main.querySelector('input[data-p="see"][data-r="' + row + '"][data-i="' + it + '"]'), chBox = $main.querySelector('input[data-p="change"][data-r="' + row + '"][data-i="' + it + '"]');
          if (cb.dataset.p === 'change' && chBox.checked) seeBox.checked = true;   // changing something means seeing it
          if (cb.dataset.p === 'see' && !seeBox.checked) chBox.checked = false;
          setPerm(row, it, seeBox.checked, chBox.checked).then(function () { S.roster = null; S.status = null; toast('Saved'); }).catch(function (e) { fail(e); accessPage(); });
        };
      });
      [].forEach.call($main.querySelectorAll('select[data-scope]'), function (sel) {
        sel.onchange = function () { DB.from('roles').update({ scope: sel.value }).eq('camp_id', S.camp.id).eq('key', sel.dataset.scope).then(must).then(function () { toast('Saved. Check each person\'s session or bunk under Staff access.'); accessPage(); }).catch(fail); };
      });
      [].forEach.call($main.querySelectorAll('[data-rmrole]'), function (b) {
        b.onclick = function () { if (!confirm('Remove this role?')) return; DB.from('roles').delete().eq('camp_id', S.camp.id).eq('key', b.dataset.rmrole).then(must).then(accessPage).catch(fail); };
      });
      [].forEach.call($main.querySelectorAll('[data-rmitem]'), function (b) {
        b.onclick = function () { if (!confirm('Remove this detail? What was entered for every camper is deleted too.')) return; DB.from('perm_items').delete().eq('camp_id', S.camp.id).eq('key', b.dataset.rmitem).then(must).then(function () { S.roster = null; accessPage(); }).catch(fail); };
      });
      document.getElementById('addrole').onsubmit = function (e) {
        e.preventDefault();
        var name = document.getElementById('rname').value.trim(), key = slug(name);
        if (roles.some(function (x) { return x.key === key; })) key = key + '_' + (roles.length + 1);
        DB.from('roles').insert({ camp_id: S.camp.id, key: key, label: name, scope: document.getElementById('rscope').value, builtin: false, sort: 100 + roles.length }).then(must)
          .then(function () { toast('Added. Now tick what ' + name + ' can see.'); accessPage(); }).catch(fail);
      };
      document.getElementById('additem').onsubmit = function (e) {
        e.preventDefault();
        var name = document.getElementById('iname').value.trim(), key = 'f_' + slug(name);
        if (items.some(function (x) { return x.key === key; })) key = key + '_' + (items.length + 1);
        DB.from('perm_items').insert({ camp_id: S.camp.id, key: key, label: name, kind: 'field', sort: 100 + items.length }).then(must)
          .then(function () { toast('Added. Tick which roles can see and change it.'); accessPage(); }).catch(fail);
      };
    }).catch(fail);
  }


  // Reorder a list of tiles by dragging the dots (mouse or finger), or with the arrow keys on the dots.
  function dragTiles(ul) {
    var drag = null;
    ul.addEventListener('pointerdown', function (e) {
      var g = e.target.closest('.grip'); if (!g) return;
      e.preventDefault();
      drag = g.closest('li'); drag.classList.add('dragging');
    });
    // While dragging near the top or bottom of the screen, scroll so long lists can be reordered end to end.
    var lastY = 0, scroller = null;
    var autoScroll = function () {
      if (!drag) { clearInterval(scroller); scroller = null; return; }
      var h = window.innerHeight, edge = 60;
      if (lastY < edge) window.scrollBy(0, -12); else if (lastY > h - edge) window.scrollBy(0, 12); else return;
      place(lastX, lastY);
    };
    var lastX = 0;
    var place = function (x, y) {
      var over = document.elementFromPoint(x, y), li = over && over.closest && over.closest('#' + ul.id + ' > li');
      if (!li || li === drag) return;
      var r = li.getBoundingClientRect();
      ul.insertBefore(drag, y > r.top + r.height / 2 ? li.nextElementSibling : li);
    };
    // Follow the pointer anywhere on the page (moving the tile in the list would drop a pointer capture).
    document.addEventListener('pointermove', function (e) {
      if (!drag || !document.body.contains(ul)) return;
      lastX = e.clientX; lastY = e.clientY;
      if (!scroller) scroller = setInterval(autoScroll, 30);
      place(e.clientX, e.clientY);
    });
    var end = function () { if (drag) { drag.classList.remove('dragging'); drag = null; } };
    document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
    ul.addEventListener('keydown', function (e) {
      var g = e.target.closest('.grip'); if (!g) return;
      var li = g.closest('li');
      if (e.key === 'ArrowUp' && li.previousElementSibling) { ul.insertBefore(li, li.previousElementSibling); g.focus(); e.preventDefault(); }
      if (e.key === 'ArrowDown' && li.nextElementSibling) { ul.insertBefore(li.nextElementSibling, li); g.focus(); e.preventDefault(); }
    });
  }

  // ---------- Daily registration report ----------
  // The same columns as supabase/functions/_shared/reports.js (tests/reports.test.mjs checks they match).
  var ageOn = function (dob, on) { if (!dob) return ''; var b = new Date(dob + 'T12:00:00Z'), d = new Date(on), a = d.getUTCFullYear() - b.getUTCFullYear(); if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--; return String(a); };
  var REPORT_COLUMNS = [
    ['name', 'Camper', function (c) { return c.name; }],
    ['last', 'Last name', function (c) { return c.last_name || String(c.name || '').split(' ').slice(1).join(' '); }],
    ['first', 'First name', function (c) { return c.first_name || String(c.name || '').split(' ')[0]; }],
    ['grade', 'Grade', function (c) { return c.grade; }],
    ['sessions', 'Sessions', function (c) { return (c.sessions || []).join(' & '); }],
    ['parents', 'Parents', function (c, f) { return f.parents; }],
    ['city', 'City', function (c, f) { return [f.city, f.state].filter(Boolean).join(', '); }],
    ['applied', 'Applied', function (c, f) { return f.applied_at ? new Date(f.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }],
    ['newfamily', 'New family', function (c, f) { return f.new_family ? 'New' : 'Sibling added'; }],
    ['age', 'Age', function (c, f, data) { return ageOn(c.dob, data.to); }],
    ['dob', 'Date of birth', function (c) { return c.dob || ''; }],
    ['gender', 'Gender', function (c) { return c.gender; }],
    ['phone', 'Phone', function (c, f) { return f.phone; }],
    ['email', 'Email', function (c, f) { return f.email; }],
    ['hebrew', 'Hebrew name', function (c) { return c.hebrew_name; }],
    ['staffchild', 'Staff child', function (c) { return c.staff_child ? 'Yes' : ''; }],
    ['campflow', 'Camp Flow family ID', function (c, f) { return f.campflow_id; }],
    ['father', 'Father', function (c, f) { return f.father; }],
    ['father_phone', 'Father phone', function (c, f) { return f.father_phone; }],
    ['father_email', 'Father email', function (c, f) { return f.father_email; }],
    ['mother', 'Mother', function (c, f) { return f.mother; }],
    ['mother_phone', 'Mother phone', function (c, f) { return f.mother_phone; }],
    ['mother_email', 'Mother email', function (c, f) { return f.mother_email; }],
    ['address', 'Address', function (c, f) { return f.address; }],
    ['emergency', 'Emergency contacts', function (c, f) { return f.emergency; }],
    ['affiliation', 'Affiliation', function (c, f) { return f.affiliation; }],
    ['occupations', 'Occupations', function (c, f) { return [f.father_occupation, f.mother_occupation].filter(Boolean).join(' / '); }],
    ['balance', 'Balance', function (c, f) { return f.balance_cents == null ? '' : (f.balance_cents < 0 ? '-' : '') + '$' + (Math.abs(f.balance_cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }); }],
    ['sfsp', 'SFSP form', function (c, f) { return ({ received: 'Received', missing: 'Missing', not_needed: 'Not needed' })[f.sfsp] || ''; }],
    ['missing', 'Forms missing', function (c) { return (c.missing_forms || []).join(', '); }],
    ['alert', 'Medical alert', function (c) { return c.alert; }],
    ['bunk', 'Bunk', function (c) { return (c.bunks || []).join(', '); }],
    ['legal', 'Legal name', function (c) { return c.legal_name; }],
    ['camper_id', 'Camp Flow camper ID', function (c) { return c.campflow_camper_id; }]
  ];
  var REPORT_DEFAULT = ['name', 'grade', 'sessions', 'parents', 'city', 'applied', 'newfamily'];
  function reportCols(keys) {
    keys = keys && keys.length ? keys : REPORT_DEFAULT;
    if (!keys.some(function (k) { return k === 'name' || k === 'first' || k === 'last'; })) keys = ['name'].concat(keys);   // every report says who
    return keys.map(function (k) {
      var b = REPORT_COLUMNS.find(function (x) { return x[0] === k; });
      if (b) return { key: k, label: b[1], get: b[2] };
      var it = (S.items || []).find(function (i) { return i.kind === 'field' && i.key === k; });
      return it ? { key: k, label: it.label, get: function (c) { return (c.fields || {})[k]; } } : null;
    }).filter(Boolean);
  }
  function reportTable(data) {
    var cols = reportCols((S.camp.settings || {}).report_columns), rows = [];
    (data.list || []).forEach(function (f) { (f.campers || []).forEach(function (c) { rows.push({ c: c, f: f }); }); });
    var head = +data.campers ? data.campers + ' new camper' + (+data.campers === 1 ? '' : 's') + ' from ' + data.families + ' famil' + (+data.families === 1 ? 'y' : 'ies') + ' (' + data.new_families + ' new to camp)' : 'No new registrations';
    return '<p><strong>' + head + '</strong> <span class="muted">· ' + esc(when(data.from)) + ' to ' + esc(when(data.to)) + '</span></p>' +
      (rows.length ? '<div class="scroll"><table class="grid"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = c.get(r.c, r.f, data); return '<td>' + (['name', 'first', 'last'].indexOf(c.key) >= 0 && r.c.id ? '<a href="#camper/' + esc(r.c.id) + '">' + esc(v) + '</a>' : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>' : '');
  }
  function reportsPage(id) {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([
      DB.from('daily_reports').select('*').eq('camp_id', S.camp.id).order('period_end', { ascending: false }).limit(60),
      id ? Promise.resolve({ data: null }) : DB.rpc('registration_preview', { p_camp: S.camp.id })
    ]).then(function (r) {
      var list = must(r[0]) || [], prev = must(r[1]), st = S.camp.settings || {};
      var off = st.report_enabled === false;
      var html = '<h1>Daily registration report</h1><p class="muted" style="max-width:820px">Every morning at 8:00 except Saturday, the campers added since the last report are emailed' +
        (isDirector() ? ' to ' + esc((st.report_to && st.report_to.length) ? st.report_to.join(', ') : 'the directors') : '') + '. Sunday\'s report covers Friday 8:00 to Sunday 8:00.' +
        (isDirector() ? ' <a href="#settings">Change who gets it and which columns it shows</a>.' : '') + '</p>' + (off ? '<p><span class="chip warn">Turned off in Settings</span></p>' : '');
      var shown = id ? list.find(function (x) { return x.id === id; }) : null;
      if (id && !shown) html += '<div class="card">Report not found.</div>';
      if (shown) html += '<p class="noprint"><a href="#reports">← All reports</a></p><div class="card"><h2 style="margin-top:0">' + esc(new Date(shown.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })) + '</h2>' + reportTable(shown.data) +
        '<p class="small muted">' + (shown.error ? '<span class="chip bad">Email failed</span> ' + esc(shown.error) : shown.sent_to.length ? 'Emailed to ' + esc(shown.sent_to.join(', ')) : 'Not emailed') + '</p><button class="noprint" onclick="print()">Print</button></div>';
      if (!id) {
        html += '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">So far for the next report</h2><button class="primary" id="runnow">Run report now</button></div>' + reportTable(prev) + '</div>';
        html += '<div class="card"><h2 style="margin-top:0">Past reports</h2>' + (list.length ? '<table class="grid"><thead><tr><th>Date</th><th>New campers</th><th>Families</th><th>Emailed</th></tr></thead><tbody>' + list.map(function (x) {
          return '<tr><td><a href="#reports/' + esc(x.id) + '">' + esc(new Date(x.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) + '</a>' + (x.manual ? ' <span class="small muted">run at ' + esc(new Date(x.period_end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) + (x.run_by ? ' by ' + esc(x.run_by) : '') + '</span>' : '') + '</td><td>' + esc(x.data.campers) + '</td><td>' + esc(x.data.families) + '</td><td class="small">' + (x.error ? '<span class="chip bad">failed</span>' : x.sent_to.length ? esc(x.sent_to.length + ' ' + (x.sent_to.length === 1 ? 'person' : 'people')) : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">The first report arrives at 8:00 tomorrow morning (or Sunday, if tomorrow is Saturday).</p>') + '</div>';
      }
      $main.innerHTML = html;
      var rn = document.getElementById('runnow');
      if (rn) rn.onclick = function () {
        var n = +prev.campers, who = isDirector() ? ((st.report_to && st.report_to.length) ? st.report_to.join(', ') : 'the directors') : 'everyone on the report list';
        if (!confirm('Email a report of ' + (n ? n + ' new camper' + (n === 1 ? '' : 's') : 'no new registrations') + ' since ' + when(prev.from) + ' to ' + who + ' now?\n\nTomorrow\'s 8:00 report will start from now.')) return;
        rn.disabled = true;
        fn('notify', { camp: S.camp.id, action: 'report_now' }).then(function (r) {
          toast(S.demo ? 'Report made (practice camp: no email is sent).' : r.error ? 'Report made, but the email failed: ' + r.error : 'Report emailed to ' + r.sent + (r.sent === 1 ? ' person' : ' people') + '.');
          location.hash = r.id ? '#reports/' + r.id : '#reports';
          if (!r.id) reportsPage();
        }).catch(function (e) { rn.disabled = false; fail(e); });
      };
    }).catch(fail);
  }

  // ---------- Settings (director) ----------
  function settingsPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([
      DB.from('staff').select('*').eq('camp_id', S.camp.id).order('role').order('email'),
      DB.from('bunks').select('id, name, session_id').eq('camp_id', S.camp.id).order('name'),
      DB.rpc('sfsp_connection', { p_camp: S.camp.id })
    ]).then(function (r) {
      var staff = must(r[0]), bunks = must(r[1]), conn = must(r[2]) || {}, st = S.camp.settings || {};
      var sname = function (id) { var s = S.sessions.find(function (x) { return x.id === id; }); return s ? s.name : ''; };
      var bname = function (id) { var b = bunks.find(function (x) { return x.id === id; }); return b ? b.name : ''; };
      var consent = S.reqs.find(function (q) { return q.key === 'consent'; });
      var html = '<h1>Settings</h1><div class="card"><div class="row" style="justify-content:space-between"><span><strong>Who can see what</strong><br><span class="small muted">Set what each role can see and change, add roles (like Kitchen or Waterfront) and add your own camper details (like T-shirt size).</span></span><a class="btn primary" href="#settings/access">Open</a></div></div><div class="two"><div>';
      html += '<div class="card"><h2 style="margin-top:0">Staff access</h2><p class="small muted">People sign in with Google or an emailed link, using exactly this address.</p><table class="grid"><tbody>' +
        staff.map(function (s) { return '<tr><td>' + esc(s.email) + (s.name ? '<div class="small muted">' + esc(s.name) + '</div>' : '') + '</td><td>' + esc(roleLabel(s.role)) + (s.session_id ? '<div class="small muted">' + esc(sname(s.session_id)) + (s.bunk_id ? ' · ' + esc(bname(s.bunk_id)) : '') + '</div>' : '') + '</td><td>' + (s.email === S.user.email.toLowerCase() && s.role === 'director' ? '' : '<button data-rm="' + s.id + '">Remove</button>') + '</td></tr>'; }).join('') +
        '</tbody></table><form id="addstaff" style="margin-top:12px"><label class="field">Email<input type="email" id="se" required></label><label class="field">Name (optional)<input type="text" id="sn"></label>' +
        '<label class="field">Role<select id="sr">' + S.roleList.map(function (r) { return '<option value="' + esc(r.key) + '" data-scope="' + r.scope + '">' + esc(r.label) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field" id="ssw" hidden>Session<select id="ss"><option value="">All sessions</option>' + S.sessions.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field" id="sbw" hidden>Bunk<select id="sbk"><option value="">Choose…</option>' + bunks.map(function (b) { return '<option value="' + b.id + '" data-s="' + b.session_id + '">' + esc(sname(b.session_id) + ': ' + b.name) + '</option>'; }).join('') + '</select></label>' +
        '<button class="primary">Add</button></form>' +
        '<p class="small muted" style="margin-top:12px">What each role can see and change is set under <a href="#settings/access">Who can see what</a>.</p></div>';
      html += '</div><div>';
      html += '<div class="card"><h2 style="margin-top:0">Camp</h2><form id="campf"><label class="field">Forms due by<input type="date" id="dl" value="' + esc(st.deadline || '') + '"></label>' +
        '<label class="field">Replies to emails go to<input type="email" id="rt" value="' + esc(st.reply_to || '') + '"></label>' +
        '<label class="field">Office phone (shown to families)<input type="text" id="ph" value="' + esc(st.phone || '') + '"></label>' +
        '<label class="check"><input type="checkbox" id="welcome"' + (st.welcome_enabled ? ' checked' : '') + '><span>Send each new family a welcome email with their links</span></label>' +
        '<label class="check"><input type="checkbox" id="rem"' + (st.reminders_enabled ? ' checked' : '') + '><span>Send automatic reminders on the schedule</span></label>' +
        '<button class="primary">Save</button></form></div>';
      var rcols = (st.report_columns && st.report_columns.length ? st.report_columns : REPORT_DEFAULT).slice();
      var allCols = REPORT_COLUMNS.map(function (c) { return [c[0], c[1]]; }).concat((S.items || []).filter(function (i) { return i.kind === 'field'; }).map(function (i) { return [i.key, i.label]; }));
      var ordered = rcols.map(function (k) { return allCols.find(function (c) { return c[0] === k; }); }).filter(Boolean).concat(allCols.filter(function (c) { return rcols.indexOf(c[0]) < 0; }));
      html += '<div class="card" id="reportcard"><h2 style="margin-top:0">Daily registration report</h2><p class="small muted">New registrations, emailed at 8:00 every morning except Saturday (Sunday covers since Friday). It\'s also under <a href="#reports">Reports</a>.</p><form id="repf">' +
        '<label class="check"><input type="checkbox" id="repon"' + (st.report_enabled === false ? '' : ' checked') + '><span>Send the daily report</span></label>' +
        '<label class="field">Email it to <span class="small muted">(separate addresses with commas; blank sends it to the directors)</span><input type="text" id="repto" value="' + esc((st.report_to || []).join(', ')) + '"></label>' +
        '<fieldset class="cols"><legend>Columns <span class="small muted">(tick the ones you want; drag them by the dots to change the order)</span></legend><ul id="repcols" class="collist">' +
        ordered.map(function (c) { return '<li class="tile' + (rcols.indexOf(c[0]) >= 0 ? ' on' : '') + '"><span class="grip" tabindex="0" role="button" aria-label="Drag to move ' + esc(c[1]) + ' (or use the arrow keys)">' + svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>') + '</span><label class="check"><input type="checkbox" data-col="' + esc(c[0]) + '"' + (rcols.indexOf(c[0]) >= 0 ? ' checked' : '') + '><span>' + esc(c[1]) + '</span></label></li>'; }).join('') +
        '</ul></fieldset><div class="row"><button class="primary">Save</button><button type="button" id="repdef">Back to the standard columns</button></div></form></div>';
      html += '<div class="card"><h2 style="margin-top:0">Required forms</h2>' + S.reqs.map(function (q) { return '<label class="check"><input type="checkbox" data-req="' + q.id + '"' + (q.active ? ' checked' : '') + '><span>' + esc(q.label) + ' <span class="small muted">(' + (q.scope === 'family' ? 'per family' : 'per camper') + ')</span></span></label>'; }).join('') +
        (consent ? '<label class="check" style="margin-top:12px"><input type="checkbox" id="disc"' + (consent.config.accept_disclosure ? ' checked' : '') + '><span>Count Camp Flow\'s "Medical Authorization" disclosure as the consent to treat</span></label>' : '') + '</div>';
      html += '<div class="card"><h2 style="margin-top:0">SFSP app connection</h2><p class="small muted">Lets the SFSP app pre-fill each family\'s meal form, tick it off when it\'s handed in, and read the roster. In the SFSP app\'s Settings → Roster app connection, enter:</p>' +
        '<dl class="kv small"><dt>Roster app address</dt><dd><code style="word-break:break-all">' + esc(cfg.supabaseUrl + '/functions/v1/sfsp') + '</code></dd><dt>Pre-fill address</dt><dd><code style="word-break:break-all">' + esc(cfg.supabaseUrl + '/functions/v1/sfsp/prefill') + '</code></dd></dl>' +
        '<p class="small muted">Then paste the SFSP app\'s camp ID and the secret it shows you below. If you ever make a new secret there, paste it here too; family links sent before that stop pre-filling.</p>' +
        '<form id="sfspf" style="margin-top:8px"><label class="field">SFSP app camp ID<input type="text" id="sc" value="' + esc(conn.sfsp_camp_id || '') + '"></label><label class="field">Parent form address<input type="text" id="su" value="' + esc(conn.sfsp_form_url || 'https://www.wgcamps.com/apply.html') + '"></label>' +
        '<label class="field">Shared secret ' + (conn.has_secret ? '<span class="chip good">saved</span>' : '<span class="chip warn">not set</span>') + '<input type="password" id="sk" autocomplete="off" placeholder="' + (conn.has_secret ? 'Leave blank to keep the saved one' : 'Paste from the SFSP app') + '"></label><button class="primary">Save</button>' +
        (conn.last_message ? '<p class="small muted">Last message from the SFSP app: ' + esc(when(conn.last_message)) + '</p>' : '') + '</form></div>';
      html += '<div class="card"><h2 style="margin-top:0">Sessions</h2><p class="small muted">Start dates are used for the SFSP age rule (campers 19 or older on the first day don\'t need the meal form) and are shared with the SFSP app.</p>' +
        S.sessions.map(function (s) { return '<div class="row" style="margin:6px 0"><strong style="flex:1;min-width:140px">' + esc(s.name) + '</strong><label class="small">Starts <input type="date" data-sstart="' + s.id + '" value="' + esc(s.starts_on || '') + '" style="width:auto"></label><label class="small">Ends <input type="date" data-send="' + s.id + '" value="' + esc(s.ends_on || '') + '" style="width:auto"></label></div>'; }).join('') +
        '<form id="sessf" class="row" style="margin-top:10px"><input type="text" id="sesn" placeholder="Session name (as in Camp Flow)" aria-label="Session name" style="flex:1"><button>Add</button></form></div>';
      html += '</div></div>';
      $main.innerHTML = html;

      var sr = document.getElementById('sr'), scopeOf = function () { var r = S.roleList.find(function (x) { return x.key === sr.value; }); return r ? r.scope : 'camp'; },
        sync = function () { document.getElementById('ssw').hidden = scopeOf() !== 'session'; document.getElementById('sbw').hidden = scopeOf() !== 'bunk'; };
      sr.onchange = sync; sync();
      document.getElementById('addstaff').onsubmit = function (e) {
        e.preventDefault();
        var role = sr.value, scope = scopeOf(), bunk = scope === 'bunk' ? document.getElementById('sbk').value : '';
        var b = bunks.find(function (x) { return x.id === bunk; });
        if (scope === 'bunk' && !b) return toast('Choose their bunk.');
        DB.from('staff').insert({ camp_id: S.camp.id, email: document.getElementById('se').value.trim().toLowerCase(), name: document.getElementById('sn').value.trim() || null, role: role,
          session_id: b ? b.session_id : (scope === 'session' ? document.getElementById('ss').value || null : null), bunk_id: b ? b.id : null, added_by: S.user.email })
          .then(must).then(function () { toast('Added. They can sign in now.'); settingsPage(); }).catch(fail);
      };
      [].forEach.call($main.querySelectorAll('[data-rm]'), function (b) { b.onclick = function () { if (confirm('Remove this access?')) DB.from('staff').delete().eq('id', b.dataset.rm).then(must).then(settingsPage).catch(fail); }; });
      document.getElementById('campf').onsubmit = function (e) {
        e.preventDefault();
        var s = Object.assign({}, S.camp.settings, { deadline: document.getElementById('dl').value || null, reply_to: document.getElementById('rt').value.trim() || null, phone: document.getElementById('ph').value.trim() || null, welcome_enabled: document.getElementById('welcome').checked, reminders_enabled: document.getElementById('rem').checked });
        DB.from('camps').update({ settings: s }).eq('id', S.camp.id).then(must).then(function () { S.camp.settings = s; toast('Saved'); }).catch(fail);
      };
      var ul = document.getElementById('repcols');
      dragTiles(ul);
      ul.addEventListener('change', function (e) { if (e.target.dataset.col) e.target.closest('li').classList.toggle('on', e.target.checked); });
      var saveReport = function (cols) {
        var to = document.getElementById('repto').value.split(/[,;\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
        var bad = to.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
        if (bad.length) return toast('Check this address: ' + bad[0]);
        if (!cols.length) return toast('Choose at least one column.');
        var s2 = Object.assign({}, S.camp.settings, { report_enabled: document.getElementById('repon').checked, report_to: to, report_columns: cols });
        DB.from('camps').update({ settings: s2 }).eq('id', S.camp.id).then(must).then(function () { S.camp.settings = s2; toast('Saved. The next report uses these.'); settingsPage(); }).catch(fail);
      };
      document.getElementById('repf').onsubmit = function (e) {
        e.preventDefault();
        saveReport([].map.call(ul.querySelectorAll('[data-col]'), function (x) { return x.checked ? x.dataset.col : null; }).filter(Boolean));
      };
      document.getElementById('repdef').onclick = function () { saveReport(REPORT_DEFAULT.slice()); };
      [].forEach.call($main.querySelectorAll('[data-req]'), function (cb) { cb.onchange = function () { DB.from('requirements').update({ active: cb.checked }).eq('id', cb.dataset.req).then(must).then(function () { S.reqs.find(function (q) { return q.id === cb.dataset.req; }).active = cb.checked; S.status = null; toast('Saved'); }).catch(fail); }; });
      var disc = document.getElementById('disc');
      if (disc) disc.onchange = function () { var c2 = Object.assign({}, consent.config, { accept_disclosure: disc.checked ? 'Medical Authorization' : null }); DB.from('requirements').update({ config: c2 }).eq('id', consent.id).then(must).then(function () { consent.config = c2; S.status = null; toast('Saved'); }).catch(fail); };
      document.getElementById('sfspf').onsubmit = function (e) {
        e.preventDefault();
        DB.rpc('set_sfsp_connection', { p_camp: S.camp.id, p_sfsp_camp_id: document.getElementById('sc').value, p_form_url: document.getElementById('su').value, p_secret: document.getElementById('sk').value || null }).then(must).then(function () { toast('Saved'); settingsPage(); }).catch(fail);
      };
      [].forEach.call($main.querySelectorAll('[data-sstart],[data-send]'), function (inp) {
        inp.onchange = function () {
          var id = inp.dataset.sstart || inp.dataset.send, patch = {}; patch[inp.dataset.sstart ? 'starts_on' : 'ends_on'] = inp.value || null;
          DB.from('sessions').update(patch).eq('id', id).then(must).then(function () { var x = S.sessions.find(function (q) { return q.id === id; }); Object.assign(x, patch); S.status = null; toast('Saved'); }).catch(fail);
        };
      });
      document.getElementById('sessf').onsubmit = function (e) {
        e.preventDefault(); var n = document.getElementById('sesn').value.trim(); if (!n) return;
        DB.from('sessions').insert({ camp_id: S.camp.id, name: n, external_name: n }).select().single().then(function (r) { S.sessions.push(must(r)); settingsPage(); }).catch(fail);
      };
    }).catch(fail);
  }

  // ---------- Activity (director) ----------
  function activityPage() {
    $main.innerHTML = '<p class="muted">Loading…</p>';
    DB.from('audit_log').select('*').eq('camp_id', S.camp.id).order('at', { ascending: false }).limit(300).then(function (r) {
      var rows = must(r);
      var what = function (x) {
        if (x.entity === 'file') return 'Opened a form file';
        if (x.entity === 'submissions') return { insert: 'Form added', update: 'Form ' + (x.detail && x.detail.status || 'changed'), delete: 'Form deleted' }[x.action];
        if (x.entity === 'staff') return { insert: 'Gave access to ', delete: 'Removed access for ', update: 'Changed access for ' }[x.action] + (x.detail ? x.detail.email + ' (' + roleLabel(x.detail.role) + ')' : '');
        if (x.entity === 'bunk_assignments') return x.action === 'insert' ? 'Placed a camper in a bunk' : 'Took a camper out of a bunk';
        if (x.entity === 'camper_health') return 'Changed a counselor alert';
        if (x.entity === 'sfsp_connection') return 'Changed the SFSP connection';
        return x.action + ' ' + x.entity;
      };
      $main.innerHTML = '<h1>Activity</h1><div class="wrap"><table class="grid"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>' +
        rows.map(function (x) { return '<tr><td class="small">' + esc(when(x.at)) + '</td><td class="small">' + esc(x.actor) + '</td><td>' + esc(what(x)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).catch(fail);
  }

  // A practice family page (portal.html?demo=...) opened from this tab sends its forms here, so they show up in the test camp.
  try {
    new BroadcastChannel('roster-demo').onmessage = function (e) {
      var m = e.data; if (!S.demo || !m || m.type !== 'submission' || m.email !== S.user.email) return;
      DB.addSubmission(m.submission); S.status = null; S.roster = null; toast('A practice form came in from the family page'); route();
    };
  } catch (e) { }

  sb.auth.onAuthStateChange(function (ev) {
    if (ev === 'PASSWORD_RECOVERY') { S.recovering = true; return showSignIn(null, 'reset'); }
    if (ev === 'USER_UPDATED') S.recovering = false;
    if (ev === 'SIGNED_IN' && !S.camp && !S.recovering) start();
  });
  start();
})();
