// Omnia AI server (Vercel). Picks the best FREE model for each job and
// automatically falls back to the next one when a limit is hit.
//
// Keys (Vercel > Settings > Environment Variables). Add as many as you can:
//   GEMINI_API_KEY   aistudio.google.com        (free)
//   GROQ_API_KEY     console.groq.com/keys      (free)
//   MISTRAL_API_KEY  console.mistral.ai         (free "Experiment" plan)
//   OPENROUTER_API_KEY, CEREBRAS_API_KEY        (optional extras)
// Optional: GOOGLE_CLIENT_ID, REQUIRE_LOGIN, ACCESS_CODE, DAILY_LIMIT, RATE_LIMIT_PER_MIN
// Change which model does which job without editing code, for example:
//   ROUTE_CODE = mistral:mistral-large-latest, groq:openai/gpt-oss-120b

const DEFAULT_ROUTES = {
  chat: "gemini:gemini-3.5-flash, mistral:mistral-medium-latest, groq:openai/gpt-oss-120b, gemini:gemini-3.5-flash-lite, cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  code: "gemini:gemini-3.5-flash, mistral:mistral-large-latest, groq:openai/gpt-oss-120b, gemini:gemini-3.5-flash-lite, cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  image: "mistral:mistral-large-latest, gemini:gemini-3.5-flash, groq:openai/gpt-oss-120b, gemini:gemini-3.5-flash-lite, cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  video: "groq:openai/gpt-oss-120b, mistral:mistral-small-latest, gemini:gemini-3.5-flash-lite, gemini:gemini-3.5-flash, cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};
const MAX_TOKENS = { chat: 4000, code: 12000, image: 12000, video: 3000 };

const PROVIDERS = {
  gemini: { key: () => process.env.GEMINI_API_KEY, vision: true },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: () => process.env.GROQ_API_KEY, vision: false },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", key: () => process.env.MISTRAL_API_KEY, vision: true, imgString: true },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", key: () => process.env.OPENROUTER_API_KEY, vision: true },
  cerebras: { url: "https://api.cerebras.ai/v1/chat/completions", key: () => process.env.CEREBRAS_API_KEY, vision: false },
  // Cloudflare Workers AI text models: uses the same CF_ACCOUNT_ID and CF_API_TOKEN as AI photos, so it is a free extra backup.
  cloudflare: { get url() { return "https://api.cloudflare.com/client/v4/accounts/" + process.env.CF_ACCOUNT_ID + "/ai/v1/chat/completions"; }, key: () => (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN ? process.env.CF_API_TOKEN : ""), vision: false },
};

const store = require("./_store.js");
const P = require("./_plan.js");
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ALLOW_GUEST = process.env.ALLOW_GUEST !== "0";
const REQUIRE_LOGIN = (!!CLIENT_ID || store.accountsOn()) && process.env.REQUIRE_LOGIN !== "0";
const hits = new Map(), daily = new Map(), tokenCache = new Map(), bad = new Map(), guestDay = new Map();

function limitedIp(ip) {
  const now = Date.now(), max = Number(process.env.RATE_LIMIT_PER_MIN || 10);
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  return recent.length > max;
}
function limitedUser(id) {
  const day = new Date().toISOString().slice(0, 10), max = Number(process.env.DAILY_LIMIT || 60);
  const rec = daily.get(id), cur = rec && rec.day === day ? rec.n : 0;
  daily.set(id, { day, n: cur + 1 });
  return cur + 1 > max;
}
function limitedGuest(ip) {
  const day = new Date().toISOString().slice(0, 10), max = Number(process.env.GUEST_DAILY_LIMIT || 8);
  const rec = guestDay.get(ip), cur = rec && rec.day === day ? rec.n : 0;
  guestDay.set(ip, { day, n: cur + 1 });
  return cur + 1 > max;
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

function parseRoute(str) {
  return String(str || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(":");
    return i > 0 ? { p: s.slice(0, i).trim(), model: s.slice(i + 1).trim() } : null;
  }).filter((x) => x && PROVIDERS[x.p]);
}

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function callGemini(model, turns, images, maxTokens, signal) {
  const contents = turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
  if (images.length) {
    const last = contents[contents.length - 1];
    last.parts = images.map((b) => ({ inline_data: { mime_type: "image/jpeg", data: b } })).concat(last.parts);
  }
  const gen = { maxOutputTokens: maxTokens };
  let think = null;
  if (/2\.5-flash/.test(model)) think = { thinkingBudget: 0 };
  else if (/3\.\d+-flash(?!-lite)/.test(model)) think = { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" };
  if (think) gen.thinkingConfig = think;
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  const post = () => fetch(url, { method: "POST", signal, headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ contents, generationConfig: gen }) });
  let r = await post();
  if (r.status === 400 && think) { delete gen.thinkingConfig; r = await post(); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status, (data.error && data.error.message) || "error");
  const cand = data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.map((p) => p.text || "").join("");
}

async function callOpenAI(name, model, turns, images, maxTokens, signal) {
  const p = PROVIDERS[name];
  const msgs = turns.map((t) => ({ role: t.role, content: t.content }));
  if (images.length) {
    const last = msgs[msgs.length - 1];
    const parts = [{ type: "text", text: last.content }];
    images.forEach((b) => { const u = "data:image/jpeg;base64," + b; parts.push({ type: "image_url", image_url: p.imgString ? u : { url: u } }); });
    last.content = parts;
  }
  const body = { model, messages: msgs };
  if (name === "groq") { body.max_completion_tokens = Math.min(maxTokens, 4000); if (/gpt-oss/.test(model)) body.reasoning_effort = "low"; }
  else body.max_tokens = name === "cloudflare" ? Math.min(maxTokens, 4000) : maxTokens;
  const r = await fetch(p.url, { method: "POST", signal, headers: { Authorization: "Bearer " + p.key(), "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw err(r.status, (data.error && (data.error.message || data.error)) || (data.message) || "error");
  const c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return Array.isArray(c) ? c.map((x) => x.text || "").join("") : String(c || "");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const configured = Object.keys(PROVIDERS).filter((n) => PROVIDERS[n].key());
  if (!configured.length) return res.status(500).json({ error: "No AI key is set on the server (add GEMINI_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY)" });

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
  }
  else if (code && !codeOk && !who) return res.status(401).json({ error: "Access code required" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limitedIp(ip)) return res.status(429).json({ error: "Too many requests" });
  if (await store.isBlocked(who ? who.email : store.guestId(req))) return res.status(403).json({ error: "Your access has been blocked. Contact support." });

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length || messages.length > 24) return res.status(400).json({ error: "Bad messages" });
  let chars = 0;
  const turns = [];
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return res.status(400).json({ error: "Bad message" });
    chars += m.content.length; turns.push({ role: m.role, content: m.content });
  }
  if (chars > 120000) return res.status(413).json({ error: "Message too long" });
  if (turns[turns.length - 1].role !== "user") return res.status(400).json({ error: "Last message must be from user" });
  const images = (Array.isArray(body.images) ? body.images.slice(0, 6) : []).filter((b) => typeof b === "string" && b.length <= 2000000);

  const task = DEFAULT_ROUTES[body.task] ? body.task : body.tier === "complex" ? "code" : body.tier === "quick" ? "video" : "chat";
  const feat = P.featureOf(body, task === "code" ? "code" : task === "video" ? "video" : "chat");
  const lim = await P.checkLimit(req, who, feat);
  if (!lim.ok) return res.status(lim.status).json({ error: lim.error, code: lim.code, retry: lim.retry, feature: lim.feature, plan: lim.plan });
  const route = parseRoute(process.env["ROUTE_" + task.toUpperCase()] || DEFAULT_ROUTES[task]);
  const maxTokens = MAX_TOKENS[task];

  const deadline = Date.now() + 54000;
  const errors = [], statuses = [];
  let attempted = 0;

  async function run(ignoreBad) {
    for (const c of route) {
      const id = c.p + ":" + c.model, prov = PROVIDERS[c.p];
      if (!prov.key()) continue;
      if (images.length && !prov.vision) continue;
      if (!ignoreBad && bad.get(id) > Date.now()) continue;
      const left = deadline - Date.now();
      if (left < 6000) return null;
      attempted++;
      try {
        const signal = AbortSignal.timeout(Math.min(left - 1000, 32000));
        const text = c.p === "gemini" ? await callGemini(c.model, turns, images, maxTokens, signal) : await callOpenAI(c.p, c.model, turns, images, maxTokens, signal);
        if (text && text.trim()) return { text, via: id };
        errors.push(id + ": empty"); statuses.push(0);
      } catch (e) {
        const st = e.status || 0; statuses.push(st);
        errors.push(id + ": " + (st || (e.name === "TimeoutError" ? "timeout" : "network")) + (e.message ? " " + String(e.message).slice(0, 60) : ""));
        if (st === 429) bad.set(id, Date.now() + 60000);
        else if (st === 404 || st === 403 || st === 401) bad.set(id, Date.now() + 30 * 60000);
        else if (st === 400) bad.set(id, Date.now() + 5 * 60000);
      }
    }
    return null;
  }

  let out = await run(false);
  if (!out && attempted === 0) out = await run(true);
  const feature = feat;
  const preview = turns[turns.length - 1].content.replace(/^\[Instructions:[\s\S]*?\]\s*/, "");
  if (out) { await store.track(req, { who, feature, prompt: preview, q: preview, a: out.text, ok: true, via: out.via }); return res.status(200).json({ text: out.text, via: out.via }); }
  await P.refund(lim.id, feat);
  await store.track(req, { who, feature, prompt: preview, ok: false });
  if (statuses.length && statuses.every((s) => s === 429)) return res.status(429).json({ error: "Free limit reached on all providers, try again in a minute" });
  return res.status(502).json({ error: "AI is busy or unavailable. " + errors.slice(0, 4).join("; ") });
};
