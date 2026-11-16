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
    x1: { label: 'Ultimate X1', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', key: '' },
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
const envKey = (rx) => { for (const [k, v] of Object.entries(process.env)) if (v && rx.test(k) && !/url|client|domain|project|_id$/i.test(k)) return v; return ''; };
export const ENVK = () => ({ groq: envKey(/groq/i), gemini: envKey(/gemini|google/i), openrouter: envKey(/openrouter/i), hf: envKey(/^hf_|^hf$|hugging/i) });
export async function cfg() { // keys fall back to Vercel env vars
  const c = await rawCfg(), e = ENVK();
  const f = { lite: e.groq, x1: e.gemini, x2: e.openrouter };
  for (const k in c.models) c.models[k].key ||= f[k] || '';
  c.image.key ||= e.hf; c.video.key ||= e.hf;
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
async function call(base, key, model, messages) {
  const x = await fetch(base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages }) });
  const t = await x.text(); let d = {}; try { d = JSON.parse(t); } catch (_) {}
  if (x.ok) return { ok: 1, text: d.choices?.[0]?.message?.content || '' };
  const e = Array.isArray(d) ? d[0] : d;
  return { ok: 0, status: x.status, msg: e?.error?.message || t.slice(0, 160) || 'no details' };
}
async function pickModel(base, key) { // ask the provider which models exist right now
  try {
    const x = await fetch(base.replace(/\/$/, '') + '/models', { headers: { Authorization: 'Bearer ' + key } });
    const d = await x.json(); const bad = /embed|whisper|tts|guard|image|imagen|veo|aqa|robotics|live|audio|moderation/i;
    let ids = (d.data || d.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter((i) => i && !bad.test(i));
    if (/openrouter/.test(base)) ids = ids.filter((i) => /:free$/.test(i));
    return ids.find((i) => /flash/i.test(i) && !/preview|exp/i.test(i)) || ids.find((i) => /llama.*(70b|8b)|gpt-oss|deepseek|qwen/i.test(i)) || ids[0];
  } catch (_) { return null; }
}
export async function chatCall(mk, messages, user) {
  const c = await cfg(); let m = c.models[mk]; if (!m) throw new Error('Model not found');
  if (!has(user, mk)) throw new Error(m.label + ' requires a subscription');
  if (!m.key) {
    const e = ENVK(), D = DEF.models;
    const alt = [{ ...D.lite, key: e.groq }, { ...D.x1, key: e.gemini }, { ...D.x2, key: e.openrouter }].find((a) => a.key);
    if (!alt) throw new Error('No API key found. Add one in Admin panel > Models, or set GROQ_API_KEY in Vercel and redeploy.');
    m = { ...m, base: alt.base, model: alt.model, key: alt.key };
  }
  let r = await call(m.base, m.key, m.model, messages);
  if (!r.ok && [400, 404].includes(r.status)) {
    const alts = /generativelanguage/.test(m.base) ? ['gemini-flash-latest', 'gemini-flash-lite-latest'] : /groq/.test(m.base) ? ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] : [];
    for (const a of alts.filter((a) => a !== m.model)) { r = await call(m.base, m.key, a, messages); if (r.ok) break; }
    if (!r.ok) { const p = await pickModel(m.base, m.key); if (p) r = await call(m.base, m.key, p, messages); }
  }
  if (!r.ok) throw new Error(new URL(m.base).hostname + ' ' + r.status + ': ' + r.msg);
  return r.text;
}
