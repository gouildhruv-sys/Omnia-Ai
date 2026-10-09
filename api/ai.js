const MODELS = {
  quick: process.env.GEMINI_MODEL_QUICK || "gemini-3.5-flash-lite",
  default: process.env.GEMINI_MODEL || "gemini-3.5-flash",
  complex: process.env.GEMINI_MODEL || "gemini-3.5-flash",
};

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const REQUIRE_LOGIN = !!CLIENT_ID && process.env.REQUIRE_LOGIN !== "0";

const hits = new Map();
const daily = new Map();
const tokenCache = new Map();

function limitedIp(ip) {
  const now = Date.now();
  const max = Number(process.env.RATE_LIMIT_PER_MIN || 8);
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

function limitedUser(id) {
  const day = new Date().toISOString().slice(0, 10);
  const max = Number(process.env.DAILY_LIMIT || 60);
  const rec = daily.get(id);
  const cur = rec && rec.day === day ? rec.n : 0;
  daily.set(id, { day, n: cur + 1 });
  return cur + 1 > max;
}

async function verifyGoogle(token) {
  const c = tokenCache.get(token);
  if (c && c.until > Date.now()) return c.who;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
    if (!r.ok) return null;
    const d = await r.json();
    if (d.aud !== CLIENT_ID) return null;
    if (Number(d.exp) * 1000 < Date.now()) return null;
    if (d.email_verified !== "true" && d.email_verified !== true) return null;
    const who = { email: d.email, name: d.name };
    tokenCache.set(token, { who, until: Math.min(Number(d.exp) * 1000, Date.now() + 300000) });
    return who;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });

  let who = null;
  const auth = String(req.headers.authorization || "");
  if (CLIENT_ID && auth.startsWith("Bearer ")) who = await verifyGoogle(auth.slice(7));
  const code = process.env.ACCESS_CODE;
  const codeOk = !!code && req.headers["x-access-code"] === code;
  if (REQUIRE_LOGIN) {
    if (!who && !codeOk) return res.status(401).json({ error: "Please sign in with Google" });
  } else if (code && !codeOk && !who) {
    return res.status(401).json({ error: "Access code required" });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limitedIp(ip)) return res.status(429).json({ error: "Too many requests" });
  if (who && limitedUser(who.email)) return res.status(429).json({ error: "Daily limit reached. Come back tomorrow." });

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length || messages.length > 24) return res.status(400).json({ error: "Bad messages" });

  let chars = 0;
  const contents = [];
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return res.status(400).json({ error: "Bad message" });
    }
    chars += m.content.length;
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
  }
  if (chars > 120000) return res.status(413).json({ error: "Message too long" });
  if (contents[contents.length - 1].role !== "user") return res.status(400).json({ error: "Last message must be from user" });

  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  if (images.length) {
    const parts = [];
    for (const b64 of images) {
      if (typeof b64 !== "string" || b64.length > 2000000) return res.status(413).json({ error: "Image too large" });
      parts.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
    }
    const last = contents[contents.length - 1];
    last.parts = parts.concat(last.parts);
  }

  const tier = MODELS[body.tier] ? body.tier : "default";
  const model = MODELS[tier];
  const generationConfig = { maxOutputTokens: tier === "quick" ? 2000 : 12000 };
  if (/2\.5-flash/.test(model)) {
    const b = process.env.GEMINI_THINKING_BUDGET;
    generationConfig.thinkingConfig = { thinkingBudget: b === undefined || b === "" ? 0 : Number(b) };
  }
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents, generationConfig }),
    });
    const data = await r.json();
    if (r.status === 429) return res.status(429).json({ error: "Free limit reached, try again later" });
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || "AI error" });
    const cand = data.candidates && data.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.map((p) => p.text || "").join("");
    if (!text) return res.status(502).json({ error: "Empty answer (" + ((cand && cand.finishReason) || "blocked") + "). Try again." });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the AI service" });
  }
};
