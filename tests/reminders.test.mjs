import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervalDays, dueEmail, buildEmail } from '../supabase/functions/_shared/reminders.js';

const deadline = '2027-06-04';
test('reminder spacing ramps up toward the deadline', () => {
  assert.equal(intervalDays(new Date('2026-12-01'), deadline), 28);
  assert.equal(intervalDays(new Date('2027-03-15'), deadline), 28);
  assert.equal(intervalDays(new Date('2027-04-10'), deadline), 14);
  assert.equal(intervalDays(new Date('2027-05-10'), deadline), 7);
  assert.equal(intervalDays(new Date('2027-05-30'), deadline), 2);
  assert.equal(intervalDays(new Date('2027-06-04'), deadline), 2);
  assert.equal(intervalDays(new Date('2027-06-10'), deadline), 7);
});

test('who gets an email today', () => {
  const on = { welcome_enabled: true, reminders_enabled: true, deadline };
  const now = new Date('2027-05-10T14:00:00Z');
  assert.equal(dueEmail({ missing: 3, welcome_sent_at: null }, on, now), 'welcome');
  assert.equal(dueEmail({ missing: 3, welcome_sent_at: null }, { ...on, welcome_enabled: false }, now), null);
  assert.equal(dueEmail({ missing: 0, welcome_sent_at: '2027-01-01' }, on, now), null, 'nothing missing');
  assert.equal(dueEmail({ missing: 2, welcome_sent_at: '2027-01-01', last_reminder: '2027-05-05T14:00:00Z' }, on, now), null, 'weekly in May: too soon');
  assert.equal(dueEmail({ missing: 2, welcome_sent_at: '2027-01-01', last_reminder: '2027-05-03T14:30:00Z' }, on, now), 'reminder', 'a week, minus a few minutes, is enough');
  assert.equal(dueEmail({ missing: 2, welcome_sent_at: '2027-01-01', last_reminder: '2027-04-01', paused_until: '2027-05-12' }, on, now), null, 'paused');
  assert.equal(dueEmail({ missing: 2, welcome_sent_at: '2027-01-01', last_reminder: '2027-04-01' }, { ...on, reminders_enabled: false }, now), null, 'reminders off');
});

test('the email lists what is missing per child and links privately', () => {
  const e = buildEmail('reminder', {
    camp: { name: 'Camp Teumim', settings: { deadline, phone: '(732) 555-0000' } },
    family: { father_first: 'Moshe', mother_first: 'Rivka', last_name: 'Levi' },
    items: [{ camper: null, key: 'sfsp', label: 'SFSP meal form', status: 'missing' }, { camper: 'Yosef', key: 'physical', label: 'Physical exam', status: 'rejected' }, { camper: 'Chaim', key: 'insurance', label: 'Health insurance', status: 'missing' }],
    links: { portal: 'https://roster.example/portal.html?t=abc', sfsp: 'https://www.wgcamps.com/apply.html?c=x&r=y' }
  });
  assert.match(e.subject, /3 forms still needed by Friday, June 4/);
  assert.match(e.text, /Dear Moshe and Rivka/);
  assert.match(e.text, /Yosef:\n  - Physical exam \(please send again\)/);
  assert.match(e.html, /apply\.html\?c=x&amp;r=y/);
  assert.match(e.html, /Open your forms/);
  assert.doesNotMatch(e.html, /<script/);
});
