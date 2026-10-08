const MODELS = {
  quick: process.env.GEMINI_MODEL_QUICK || "gemini-2.5-flash-lite",
  default: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  complex: process.env.GEMINI_MODEL || "gemini-2.5-flash",
};

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const max = Number(process.env.RATE_LIMIT_PER_MIN || 6);
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });

  const code = process.env.ACCESS_CODE;
  if (code && req.headers["x-access-code"] !== code) return res.status(401).json({ error: "Access code required" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many requests" });

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
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODELS[tier] + ":generateContent";
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: tier === "quick" ? 2000 : 16384 } }),
    });
    const data = await r.json();
    if (r.status === 429) return res.status(429).json({ error: "Free limit reached, try again later" });
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || "AI error" });
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("");
    if (!text) return res.status(502).json({ error: "Empty answer. Try again." });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the AI service" });
  }
};
