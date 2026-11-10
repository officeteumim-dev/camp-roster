// Family links (portal) and SFSP links, used by emails and by the staff app's "copy family link".
import { newToken, sha256Hex, sfspRef } from './crypto.js';

export function appUrl() { return (Deno.env.get('APP_URL') || 'https://roster.wgcamps.com').replace(/\/+$/, ''); }

// Links work until the end of September after the forms deadline (or after this summer, if no deadline is set).
export function linkExpiry(camp, now = new Date()) {
  const d = camp?.settings?.deadline ? new Date(camp.settings.deadline + 'T00:00:00Z') : null;
  const year = d && !isNaN(d) ? d.getUTCFullYear() : (now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());
  return new Date(Date.UTC(year, 8, 30, 23, 59, 59)).toISOString();
}

export async function newFamilyLink(db, camp, familyId) {
  const token = newToken();
  const { error } = await db.from('family_links').insert({ camp_id: camp.id, family_id: familyId, token_hash: await sha256Hex(token), expires_at: linkExpiry(camp) });
  if (error) throw new Error('link: ' + error.message);
  return `${appUrl()}/portal.html?t=${token}`;
}

export async function familyFromToken(db, token) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token || '')) return null;
  const { data } = await db.from('family_links').select('id, camp_id, family_id, expires_at, revoked_at').eq('token_hash', await sha256Hex(token)).maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  await db.from('family_links').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data;
}

// The family's personal SFSP form link, or null when the SFSP connection isn't set up.
export async function sfspLink(db, campId, household) {
  const { data: s } = await db.from('camp_secrets').select('sfsp_camp_id, sfsp_form_url, sfsp_secret').eq('camp_id', campId).maybeSingle();
  if (!s?.sfsp_camp_id || !s.sfsp_form_url) return null;
  const u = new URL(s.sfsp_form_url);
  u.searchParams.set('c', s.sfsp_camp_id);
  if (s.sfsp_secret) u.searchParams.set('r', await sfspRef(s.sfsp_secret, household));
  return u.toString();
}
