// Omnia image server (Vercel). Real AI image generation using FREE providers, with automatic fallback.
//
// Keys (Vercel > Settings > Environment Variables):
//   CF_ACCOUNT_ID + CF_API_TOKEN   Cloudflare Workers AI (FLUX.1 schnell). Free daily allowance, best option.
//   POLLINATIONS_KEY               optional, from enter.pollinations.ai (free)
//   IMAGE_ROUTE                    optional, order of providers, default: cloudflare, pollinations
//   IMAGE_DAILY_LIMIT              per signed-in user per day, default 20
//   GUEST_IMAGE_LIMIT              per guest address per day, default 3
// Login settings are shared with api/ai.js: GOOGLE_CLIENT_ID, REQUIRE_LOGIN, ALLOW_GUEST, ACCESS_CODE.

const store = require("./_store.js");
const P = require("./_plan.js");
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const REQUIRE_LOGIN = (!!CLIENT_ID || store.accountsOn()) && process.env.REQUIRE_LOGIN !== "0";
const ALLOW_GUEST = process.env.ALLOW_GUEST !== "0";
const hits = new Map(), daily = new Map(), tokenCache = new Map(), bad = new Map();

function bump(map, key, max) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = map.get(key), cur = rec && rec.day === day ? rec.n : 0;
  map.set(key, { day, n: cur + 1 });
  return cur + 1 > max;
}
function limitedIp(ip) {
  const now = Date.now(), max = Number(process.env.RATE_LIMIT_PER_MIN || 10);
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  return recent.length > max;
}
async function verifyGoogle(token) {
  const c = tokenCache.get(token);
  if (c && c.until > Date.now()) return c.who;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
    if (!r.ok) return null;
    const d = await r.json();
    if (d.aud !== CLIENT_ID || Number(d.exp) * 1000 < Date.now()) return null;
    if (d.email_verified !== "true" && d.email_verified !== true) return null;
    const who = { email: d.email, name: d.name };
    tokenCache.set(token, { who, until: Math.min(Number(d.exp) * 1000, Date.now() + 300000) });
    return who;
  } catch (e) { return null; }
}
function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function cloudflare(prompt, signal, steps) {
  const id = process.env.CF_ACCOUNT_ID, tok = process.env.CF_API_TOKEN;
  const model = process.env.CF_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + id + "/ai/run/" + model, {
    method: "POST", signal,
    headers: { Authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ prompt: prompt.slice(0, 1800), steps: steps || 4 }),
  });
  const ct = r.headers.get("content-type") || "";
  if (/^image\//.test(ct)) {
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) throw err(r.status, "error");
    return "data:" + ct.split(";")[0] + ";base64," + buf.toString("base64");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const m = data.errors && data.errors[0] && data.errors[0].message;
    throw err(r.status || 502, m || "error");
  }
  const b64 = data.result && (data.result.image || data.result);
  if (!b64 || typeof b64 !== "string") throw err(502, "no image");
  return "data:image/jpeg;base64," + b64;
}

async function pollinations(prompt, signal, steps) {
  const key = process.env.POLLINATIONS_KEY;
  const seed = Math.floor(Math.random() * 1e6);
  const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt.slice(0, 1500)) + "?width=1024&height=1024&model=flux&nologo=true&seed=" + seed + (key ? "&key=" + encodeURIComponent(key) : "");
  const r = await fetch(url, { signal, headers: key ? { Authorization: "Bearer " + key } : {} });
  if (!r.ok) throw err(r.status, "error");
  const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!/^image\//.test(ct)) throw err(502, "not an image");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 3200000) throw err(502, "image too large");
  return "data:" + ct + ";base64," + buf.toString("base64");
}

const PROVIDERS = {
  cloudflare: { run: cloudflare, ready: () => !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) },
  pollinations: { run: pollinations, ready: () => true },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  let who = null;
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer omnia.")) who = store.verifySession(auth.slice(7));
  else if (CLIENT_ID && auth.startsWith("Bearer ")) who = await verifyGoogle(auth.slice(7));
  const code = process.env.ACCESS_CODE, codeOk = !!code && req.headers["x-access-code"] === code;
  let guest = false;
  if (REQUIRE_LOGIN) {
    if (!who && !codeOk) {
      if (ALLOW_GUEST && req.headers["x-guest"] === "1") guest = true;
      else return res.status(401).json({ error: "Please sign in" });
    }
  } else if (code && !codeOk && !who) return res.status(401).json({ error: "Access code required" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limitedIp(ip)) return res.status(429).json({ error: "Too many requests" });
  if (await store.isBlocked(who ? who.email : store.guestId(req))) return res.status(403).json({ error: "Your access has been blocked. Contact support." });

  const body = req.body || {};
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 1800) return res.status(400).json({ error: "Bad prompt" });

  const feat = P.featureOf(body, "image");
  const lim = await P.checkLimit(req, who, feat);
  if (!lim.ok) return res.status(lim.status).json({ error: lim.error, code: lim.code, retry: lim.retry, feature: lim.feature, plan: lim.plan });
  const steps = lim.plan === 2 ? Number(process.env.CF_STEPS_PREMIUM || 8) : Number(process.env.CF_STEPS || 6);
  const order = String(process.env.IMAGE_ROUTE || "cloudflare, pollinations").split(",").map((s) => s.trim()).filter((n) => PROVIDERS[n]);
  const errors = [], statuses = [];
  const deadline = Date.now() + 54000;
  let tried = 0;
  async function run(ignoreBad) {
    for (const name of order) {
      const p = PROVIDERS[name];
      if (!p.ready()) continue;
      if (!ignoreBad && bad.get(name) > Date.now()) continue;
      const left = deadline - Date.now();
      if (left < 6000) return null;
      tried++;
      try {
        const image = await p.run(prompt, AbortSignal.timeout(Math.min(left - 1000, 40000)), steps);
        return { image, via: name };
      } catch (e) {
        const st = e.status || 0; statuses.push(st);
        errors.push(name + ": " + (st || (e.name === "TimeoutError" ? "timeout" : "network")) + (e.message ? " " + String(e.message).slice(0, 80) : ""));
        if (st === 429) bad.set(name, Date.now() + 60000);
        else if (st === 401 || st === 403 || st === 404) bad.set(name, Date.now() + 30 * 60000);
      }
    }
    return null;
  }
  let out = await run(false);
  if (!out && tried === 0) out = await run(true);
  const feature = feat;
  if (out) { await store.track(req, { who, feature, prompt, q: prompt, a: "[picture created]", ok: true, via: out.via }); return res.status(200).json(out); }
  await P.refund(lim.id, feat);
  await store.track(req, { who, feature, prompt, ok: false });
  if (statuses.length && statuses.every((s) => s === 429)) return res.status(429).json({ error: "Free image limit reached, try again later" });
  return res.status(502).json({ error: "Image AI is busy or not set up. " + errors.slice(0, 3).join("; ") });
};
