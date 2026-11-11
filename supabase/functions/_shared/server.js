// Shared by the server functions (Supabase Edge Functions, Deno).
import { createClient } from 'npm:@supabase/supabase-js@2';

export const env = k => Deno.env.get(k) ?? '';
export const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// Accepts "roster.wgcamps.com" or "https://roster.wgcamps.com/".
export const withScheme = u => { u = String(u || '').trim().replace(/\/+$/, ''); return u && !/^https?:\/\//i.test(u) ? 'https://' + u : u; };
const allowedOrigin = () => withScheme(env('APP_ORIGIN')) || '*';
export const cors = { 'Access-Control-Allow-Origin': allowedOrigin(), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-import-key, x-wg-signature, x-wg-timestamp', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
export const fail = (message, status = 400) => json({ error: message }, status);

// The signed-in staff member behind a request, with their roles in the camp. Null if not signed in.
export async function staffFor(req, db, campId) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  const email = data.user.email.toLowerCase();
  const { data: rows } = await db.from('staff').select('role, session_id, bunk_id').eq('camp_id', campId).eq('email', email);
  return { email, roles: (rows || []).map(r => r.role) };
}

export async function campBySlugOrId(db, v) {
  const q = db.from('camps').select('*');
  const { data, error } = /^[0-9a-f-]{36}$/.test(v || '') ? await q.eq('id', v).maybeSingle() : await q.eq('slug', v || '').maybeSingle();
  if (error) throw new Error('Database: ' + error.message);
  return data;
}

// Constant-time comparison of two strings.
export function sameText(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function chunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

export function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
