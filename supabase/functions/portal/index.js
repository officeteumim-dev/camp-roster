// The family portal's server side. Families have no account: their emailed link carries a long random token.
// POST {t, action: 'view' | 'upload-urls' | 'submit', ...}
import { admin, json, fail, cors, must } from '../_shared/server.js';
import { familyFromToken, sfspLink } from '../_shared/links.js';
import { checkSubmission, uploadPath, pathBelongs, UPLOAD_TYPES, MAX_UPLOAD } from '../_shared/forms.js';
import { newToken } from '../_shared/crypto.js';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('POST only', 405);
  let body;
  try { body = await req.json(); } catch { return fail('Bad request'); }
  const db = admin();
  const link = await familyFromToken(db, body.t);
  if (!link) return fail('This link has expired or is not valid. Please contact the camp office for a new one.', 401);

  try {
    if (body.action === 'view') return json(await view(db, link));
    if (body.action === 'upload-urls') return json(await uploadUrls(db, link, body));
    if (body.action === 'submit') return json(await submit(db, link, body));
    return fail('Unknown action');
  } catch (e) {
    console.error(e);
    return fail(e.expose ? e.message : 'Something went wrong. Please try again.', e.expose ? 400 : 500);
  }
});

const userError = msg => Object.assign(new Error(msg), { expose: true });

async function view(db, link) {
  const v = must(await db.rpc('portal_view', { p_family: link.family_id }), 'view');
  const { data: fam } = await db.from('families').select('external_id').eq('id', link.family_id).single();
  const { data: camp } = await db.from('camps').select('id, settings').eq('id', link.camp_id).single();
  return { ...v, sfsp_link: await sfspLink(db, camp, fam.external_id) };
}

async function requirementFor(db, link, requirementId, camperId) {
  const { data: r } = await db.from('requirements').select('*').eq('id', requirementId).eq('camp_id', link.camp_id).eq('active', true).maybeSingle();
  if (!r) throw userError('That form is not on the list.');
  if (r.scope === 'camper') {
    const { data: c } = await db.from('campers').select('id').eq('id', camperId || '').eq('family_id', link.family_id).eq('active', true).maybeSingle();
    if (!c) throw userError('Please choose which child this form is for.');
  }
  return r;
}

async function uploadUrls(db, link, body) {
  await requirementFor(db, link, body.requirement_id, body.camper_id);
  const files = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  if (!files.length) throw userError('No files chosen.');
  const batch = newToken(9);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!UPLOAD_TYPES.includes(f.type)) throw userError(`${f.name}: please send a photo (JPEG, PNG, HEIC) or a PDF.`);
    if (!(f.size > 0 && f.size <= MAX_UPLOAD)) throw userError(`${f.name} is too large (15 MB at most).`);
    const path = uploadPath(link.camp_id, link.family_id, batch, i, f.name);
    const s = must(await db.storage.from('forms').createSignedUploadUrl(path), 'upload link');
    out.push({ path, token: s.token, name: f.name, type: f.type, size: f.size });
  }
  return { uploads: out };
}

async function submit(db, link, body) {
  const r = await requirementFor(db, link, body.requirement_id, body.camper_id);
  const files = [];
  for (const f of Array.isArray(body.files) ? body.files.slice(0, 10) : []) {
    if (!pathBelongs(f.path, link.camp_id, link.family_id)) throw userError('One of the files could not be found. Please add it again.');
    const folder = f.path.split('/').slice(0, -1).join('/'), name = f.path.split('/').pop();
    const { data: found } = await db.storage.from('forms').list(folder, { search: name });
    if (!found?.some(o => o.name === name)) throw userError('One of the files did not finish uploading. Please add it again.');
    files.push({ path: f.path, name: String(f.name || name).slice(0, 120), type: f.type, size: f.size });
  }
  const checked = checkSubmission(r, { files, answers: body.answers });
  if (checked.error) throw userError(checked.error);
  must(await db.from('submissions').insert({
    camp_id: link.camp_id, requirement_id: r.id, family_id: link.family_id, camper_id: r.scope === 'camper' ? body.camper_id : null,
    status: checked.status, files: checked.files, answers: checked.answers, submitted_by: 'family',
  }), 'save');
  return view(db, link);
}
