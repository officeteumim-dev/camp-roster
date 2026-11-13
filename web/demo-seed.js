// Camp Test Site: the same families and campers as the SFSP app's Camp Test Site.
// This is a faithful copy of the camper part of demoSeed() in the SFSP app (officeteumim-dev/sfsp-wgroup, index.html):
// same random-number generator, same seed (4242), same order of draws, so the names, family groupings, ages, sessions,
// staff children and which families handed in the SFSP form come out identical. tests/demo-seed.test.mjs checks it
// against the SFSP app's own code. If the SFSP app changes its generator, update this and rerun that test.
(function (root) {
  'use strict';

  function demoRng(seed) { var a = seed >>> 0; return function () { a = a + 0x6D2B79F5 >>> 0; var t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var ELIG = { free: [20748, 28132, 35516, 42900, 50284, 57668, 65052, 72436], freeEach: 7384, reduced: [29526, 40034, 50542, 61050, 71558, 82066, 92574, 103082], reducedEach: 10508 };
  function limitFor(table, each, size) { if (!size) return 0; if (size <= table.length) return table[size - 1]; return table[table.length - 1] + (size - table.length) * each; }

  var BF = ['Aaron','Ari','Avi','Ben','Chaim','Dani','David','Dov','Eli','Ezra','Gabe','Jacob','Jonah','Levi','Meir','Micah','Moshe','Natan','Noah','Sam','Shai','Simcha','Yoni','Zev','Asher','Eitan','Max','Josh','Ilan','Nate'];
  var GF = ['Ava','Batya','Chana','Dina','Esther','Gila','Hannah','Leah','Maya','Mia','Miri','Nava','Noa','Rachel','Rina','Rivka','Sara','Shira','Talia','Tova','Yael','Zahava','Ella','Adina','Ayelet','Elisheva','Malka','Penina','Liora','Naomi'];
  var LN = ['Adler','Berg','Cohen','Davis','Eisen','Feld','Friedman','Gold','Green','Halpern','Katz','Klein','Kaplan','Levin','Levy','Marcus','Neuman','Orlov','Pearl','Rosen','Roth','Schwartz','Shapiro','Silver','Stern','Weiss','Wolf','Zimmer','Baum','Fisher','Hirsch','Kramer','Lerner','Mandel','Perlman','Rubin','Segal','Singer','Tauber','Wexler'];
  var RACES = ['white','white','white','white','black','asian','native_american','pacific_islander'];

  // The season the SFSP test site shows: this year from July on, otherwise last year.
  function demoYear(now) { var d = now || new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; }

  // Returns { year, sessions, families: [{n, session, last, staff, sfsp, kids: [{name, first, age}]}] } in generation order.
  function campers(now) {
    var Y = demoYear(now), R = demoRng(4242);
    var pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var int = function (a, b) { return a + Math.floor(R() * (b - a + 1)); };
    var famIncome = function (size, band) { var f = limitFor(ELIG.free, ELIG.freeEach, size), r = limitFor(ELIG.reduced, ELIG.reducedEach, size); return band === 'free' ? Math.round(f * (0.55 + R() * 0.4)) : band === 'reduced' ? Math.round(f + (r - f) * (0.2 + R() * 0.7)) : Math.round(r * (1.1 + R() * 0.8)); };
    var sessions = [
      { key: 'boys', name: 'Boys session', start: Y + '-06-20', end: Y + '-07-20', gender: 'Male' },
      { key: 'girls', name: 'Girls session', start: Y + '-07-25', end: Y + '-08-20', gender: 'Female' }
    ];
    var families = [];
    sessions.forEach(function (S0) {
      var sid = S0.key, F = sid === 'boys' ? BF : GF, left = 250, staffLeft = sid === 'boys' ? 13 : 14;
      while (left > 0) {
        var n = Math.min(left, R() < 0.6 ? 1 : R() < 0.75 ? 2 : 3); left -= n;
        var last = pick(LN);
        var isStaff = staffLeft > 0 && R() < 0.09; if (isStaff) staffLeft -= n;
        var kids = []; for (var k = 0; k < n; k++) { var first = pick(F); kids.push({ first: first, name: first + ' ' + last, age: int(12, 19) }); }
        var fam = { n: families.length + 1, session: sid, last: last, staff: isStaff, sfsp: false, kids: kids.slice() };
        families.push(fam);
        var young = kids.filter(function (x) { return x.age <= 18; });
        if (!young.length) continue;
        n = young.length;
        var hasForm = R() < 0.72;
        if (!hasForm) continue;
        fam.sfsp = true;
        // The draws the SFSP app makes while building the family's form. Kept in the same order so later families match.
        var band = R() < 0.32 ? 'snap' : R() < 0.55 ? 'free' : R() < 0.7 ? 'reduced' : 'denied';
        var size = n + int(2, 4);
        famIncome(size, band === 'snap' ? 'free' : band);       // members: the parent's income
        if (band === 'snap') int(100000, 999999);               // caseNumber
        else famIncome(size, band);                               // annualIncome
        int(10, 999); int(0, 9); int(1000, 9999);                 // signer address, phone
        if (band !== 'snap') int(1000, 9999);                     // ssn4
        if (!(R() < 0.12)) R();                                   // ethnicity
        if (!(R() < 0.06)) pick(RACES);                           // races
        int(3, 40);                                               // submitted date
        int(8, 21);                                               // submitted hour
      }
    });
    return { year: Y, sessions: sessions, families: families };
  }

  var api = { campers: campers, demoYear: demoYear, demoRng: demoRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DemoSeed = api;
})(typeof window !== 'undefined' ? window : globalThis);
