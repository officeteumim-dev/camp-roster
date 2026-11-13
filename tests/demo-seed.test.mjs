// Checks that the roster app's Camp Test Site has exactly the same families and campers as the SFSP app's,
// by running the camper part of the SFSP app's own demoSeed() next to ours. Needs a copy of the SFSP repo
// (SFSP_REPO=/path/to/sfsp-wgroup, or ../sfsp-wgroup next to this repo); skipped without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// demo-seed.js is a plain browser script: run it as the browser would.
const seedWin = { Math, Date };
vm.runInNewContext(await readFile(new URL('../web/demo-seed.js', import.meta.url), 'utf8'), { window: seedWin, Math, Date });
const DemoSeed = seedWin.DemoSeed;

async function sfspSource() {
  for (const p of [process.env.SFSP_REPO, new URL('../../sfsp-wgroup', import.meta.url).pathname].filter(Boolean)) {
    try { return await readFile(p.replace(/\/$/, '') + '/index.html', 'utf8'); } catch {}
  }
  return null;
}

function sfspRoster(html, now) {
  const start = html.indexOf('function demoSeed(){');
  const end = html.indexOf('  // About 95% done', start);
  assert.ok(start > 0 && end > start, 'found demoSeed() in the SFSP app');
  const helpers = ['function demoRng(', 'const ELIG_DEFAULT=', 'function limitFor('].map(sig => { const i = html.indexOf(sig); return html.slice(i, html.indexOf('\n', i)); });
  const code = `
    const pad=n=>String(n).padStart(2,'0');
    const iso=d=>\`\${d.getFullYear()}-\${pad(d.getMonth()+1)}-\${pad(d.getDate())}\`;
    const parse=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
    const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
    const mdy=d=>iso(d);
    let ridN=0; const rid=()=>'k'+(++ridN);
    const S={me:{email:'test@example.com',name:'Test'}};
    const DEMO_ID='demo',DEMO_NAME='Camp Test Site';
    const demoYear=()=>{const d=NOW;return d.getMonth()>=6?d.getFullYear():d.getFullYear()-1};
    const demoSigs=()=>['sig'];
    const appOfficial=()=>({result:'Free'}); const resultCode=()=>'1';
    ${helpers.join('\n')}
    ${html.slice(start, end)}
    return {roster, apps}; }
    demoSeed();`;
  // Copy out of the sandbox so the comparison sees plain arrays.
  return JSON.parse(JSON.stringify(vm.runInNewContext(code, { NOW: now, Date, Math, String, Number, Array, Set, Object, JSON })));
}

test('Camp Test Site matches the SFSP app family for family, child for child', async t => {
  const html = await sfspSource();
  if (!html) return t.skip('SFSP repo not found (set SFSP_REPO)');
  for (const now of [new Date('2026-11-13T12:00:00'), new Date('2027-03-01T12:00:00'), new Date('2027-08-01T12:00:00')]) {
    const theirs = sfspRoster(html, now);
    const ours = JSON.parse(JSON.stringify(DemoSeed.campers(now)));
    for (const sid of ['boys', 'girls']) {
      const ourKids = ours.families.filter(f => f.session === sid).flatMap(f => f.kids.map(k => ({ name: k.name, staff: f.staff, form: f.sfsp && k.age <= 18, o18: k.age > 18 })));
      const theirKids = theirs.roster[sid].map(k => ({ name: k.name, staff: !!k.staff, form: !!k.form, o18: !!k.o18 }));
      // The SFSP roster lists a family's 19-year-olds first; compare as sets per family by sorting names.
      const key = k => `${k.name}|${k.staff}|${k.form}|${k.o18}`;
      assert.deepEqual(ourKids.map(key).sort(), theirKids.map(key).sort(), `${sid} campers match (${now.toISOString().slice(0, 10)})`);
      assert.equal(ourKids.length, 250);
    }
    assert.equal(ours.families.filter(f => f.sfsp).length, theirs.apps.length, 'same families handed in the SFSP form');
  }
});

test('the generator is stable', () => {
  const a = JSON.parse(JSON.stringify(DemoSeed.campers(new Date('2026-11-13')))), b = JSON.parse(JSON.stringify(DemoSeed.campers(new Date('2026-11-13'))));
  assert.deepEqual(a, b);
  assert.equal(a.year, 2026);
  assert.equal(a.families.reduce((n, f) => n + f.kids.length, 0), 500);
});
