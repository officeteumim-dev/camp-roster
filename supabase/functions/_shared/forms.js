// What counts as a complete submission for each kind of requirement. Used by the family portal function and by the
// staff app (paper forms), and tested on its own.

const text = (v, max = 2000) => String(v ?? '').replace(/\s+$/g, '').slice(0, max).trim();

// requirement: {kind, scope, config}; input: {files: [{path,...}], answers: {...}}
// Returns {status, answers, files} or {error}.
export function checkSubmission(requirement, input) {
  const files = Array.isArray(input?.files) ? input.files.slice(0, 10) : [];
  const a = input?.answers && typeof input.answers === 'object' ? input.answers : {};
  const cfg = requirement.config || {};
  switch (requirement.kind) {
    case 'sfsp':
      return { error: 'The SFSP form is filled in on the SFSP site.' };
    case 'upload': {
      const answers = {};
      for (const f of cfg.fields || []) {
        const v = text(a[f.key], 200);
        if (!v && !f.optional) return { error: `Please fill in ${f.label}.` };
        if (v) answers[f.key] = v;
      }
      if (files.length < (cfg.min_files ?? 1)) return { error: 'Please add a photo or file of the form.' };
      return { status: 'received', answers, files };
    }
    case 'consent': {
      const name = text(a.signed_name, 120);
      if (a.agree !== true) return { error: 'Please tick the box to give permission.' };
      if (name.length < 3) return { error: 'Please type your full name as your signature.' };
      return { status: 'received', answers: { agree: true, signed_name: name, text: cfg.text || '', signed_at: new Date().toISOString() }, files: [] };
    }
    case 'questionnaire': {
      if (a.has_any === 'no') return { status: 'not_needed', answers: { has_any: 'no' }, files };
      if (a.has_any !== 'yes') return { error: 'Please answer whether there are any allergies, medical conditions or medications.' };
      const answers = { has_any: 'yes' };
      for (const k of ['allergies', 'conditions', 'medications', 'diet', 'other']) { const v = text(a[k]); if (v) answers[k] = v; }
      if (!answers.allergies && !answers.conditions && !answers.medications) return { error: 'Please describe the allergies, conditions or medications.' };
      answers.epipen = a.epipen === true;
      answers.inhaler = a.inhaler === true;
      return { status: 'received', answers, files };
    }
    default:
      return { error: 'Unknown form type.' };
  }
}

// Storage path for a family's upload: <camp>/<family>/<batch>/<n>-<safe name>
export function uploadPath(campId, familyId, batch, n, name) {
  const safe = String(name || 'file').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[_.]+/, '').slice(-80) || 'file';
  return `${campId}/${familyId}/${batch}/${n}-${safe}`;
}
export const pathBelongs = (path, campId, familyId) => typeof path === 'string' && path.startsWith(`${campId}/${familyId}/`) && !path.includes('..');

export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
export const MAX_UPLOAD = 15 * 1024 * 1024;
