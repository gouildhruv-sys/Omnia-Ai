import crypto from 'node:crypto';
const U = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export async function r(...cmd) {
  if (!U) throw new Error('Database not connected (Upstash Redis). See README.');
  const x = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: JSON.stringify(cmd) });
  const d = await x.json(); if (d.error) throw new Error(d.error); return d.result;
}
export const getJ = async (k) => { const v = await r('GET', k); return v ? JSON.parse(v) : null; };
export const setJ = (k, v) => r('SET', k, JSON.stringify(v));
export const ok = (res, o, c = 200) => res.status(c).json(o);
export const hash = (p, s) => crypto.createHash('sha256').update(s + p).digest('hex');
export const rid = () => crypto.randomBytes(24).toString('hex');

export const DEF = {
  models: {
    lite: { label: 'Omnyx Lite', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: '' },
    x1: { label: 'Ultimate X1', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', key: '' },
    x2: { label: 'Ultimate X2', base: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat-v3-0324:free', key: '' },
  },
  image: { type: 'pollinations', base: '', model: 'black-forest-labs/FLUX.1-schnell', key: '' },
  video: { base: 'https://router.huggingface.co/hf-inference/models/Lightricks/LTX-Video', key: '' },
  promo: { code: 'Evilex100', days: 3 },
};
export async function rawCfg() {
  const s = (await getJ('cfg')) || {};
  const m = {}; for (const k in DEF.models) m[k] = { ...DEF.models[k], ...(s.models?.[k] || {}) };
  return { models: m, image: { ...DEF.image, ...(s.image || {}) }, video: { ...DEF.video, ...(s.video || {}) }, promo: { ...DEF.promo, ...(s.promo || {}) } };
}
export async function cfg() { // keys fall back to env vars
  const c = await rawCfg(), e = process.env;
  const f = { lite: e.GROQ_API_KEY, x1: e.GEMINI_API_KEY, x2: e.OPENROUTER_API_KEY };
  for (const k in c.models) c.models[k].key ||= f[k] || '';
  c.image.key ||= e.HF_TOKEN || ''; c.video.key ||= e.HF_TOKEN || '';
  return c;
}
export const pub = (u) => ({ first: u.first, last: u.last, email: u.email, subs: u.subs || {}, locConsent: !!u.locConsent });
export async function authUser(req) {
  const t = req.headers['x-token']; if (!t) throw new Error('Please log in');
  const email = await r('GET', 't:' + t); if (!email) throw new Error('Session expired, please log in again');
  const u = await getJ('u:' + email); if (!u) throw new Error('Account not found');
  if (u.banned) throw new Error('Your account is suspended');
  return u;
}
export const has = (u, m) => m === 'lite' || (u.subs?.[m] || 0) > Date.now();
export async function chatCall(mk, messages, user) {
  const c = await cfg(), m = c.models[mk]; if (!m) throw new Error('Model not found');
  if (!has(user, mk)) throw new Error(m.label + ' requires a subscription');
  if (!m.key) throw new Error(m.label + ' API key is not set in the admin panel');
  const x = await fetch(m.base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + m.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m.model, messages }),
  });
  const d = await x.json().catch(() => ({}));
  if (!x.ok) throw new Error(d?.error?.message || 'AI error ' + x.status);
  return d.choices?.[0]?.message?.content || '';
}
