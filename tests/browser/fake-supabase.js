// A stand-in for supabase-js used only by the page checks (no network). Answers from window.FAKE fixtures.
(function () {
  function result(table, st) {
    var F = window.FAKE, rows = (F.tables[table] || []).slice();
    st.eqs.forEach(function (e) { if (e[0].indexOf('.') < 0) rows = rows.filter(function (r) { return r[e[0]] === undefined || r[e[0]] === e[1]; }); });
    if (st.write) { F.writes.push({ table: table, op: st.write, value: st.value }); return { data: st.one ? (st.value && st.value[0] || st.value) : st.value, error: null }; }
    if (st.one) return { data: rows[0] || null, error: rows[0] || st.maybe ? null : { message: 'not found' } };
    return { data: rows, error: null };
  }
  function builder(table) {
    var st = { eqs: [], one: false, maybe: false, write: null, value: null };
    var b = {
      select: function () { return b; }, order: function () { return b; }, limit: function () { return b; }, range: function () { return b; },
      in: function () { return b; }, not: function () { return b; }, neq: function () { return b; },
      eq: function (k, v) { st.eqs.push([k, v]); return b; },
      single: function () { st.one = true; return b; }, maybeSingle: function () { st.one = true; st.maybe = true; return b; },
      insert: function (v) { st.write = 'insert'; st.value = v; return b; }, update: function (v) { st.write = 'update'; st.value = v; return b; },
      upsert: function (v) { st.write = 'upsert'; st.value = v; return b; }, delete: function () { st.write = 'delete'; return b; },
      then: function (ok, bad) { return Promise.resolve(result(table, st)).then(ok, bad); }
    };
    return b;
  }
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: window.FAKE.session } }); },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { return Promise.resolve({}); }, signInWithOAuth: function () {}, signInWithOtp: function () { return Promise.resolve({}); }
        },
        from: builder,
        rpc: function (name, args) { var f = window.FAKE.rpc[name]; return Promise.resolve({ data: typeof f === 'function' ? f(args) : f, error: null }); },
        storage: { from: function () { return {
          upload: function () { return Promise.resolve({ data: {}, error: null }); },
          createSignedUrl: function () { return Promise.resolve({ data: { signedUrl: 'about:blank' }, error: null }); },
          uploadToSignedUrl: function () { return Promise.resolve({ data: {}, error: null }); }
        }; } }
      };
    }
  };
})();
