// OPTIONAL real AI video through fal.ai. Turns on only when FAL_KEY is set in Vercel.
// Uses paid credits, so it is limited per signed-in person (VIDEO_AI_DAILY_LIMIT, default 2) and guests are not allowed.
// FAL_VIDEO_MODEL can change the model (default fal-ai/ltx-video).
const store = require("./_store.js");
const daily = new Map();
function bump(id, max) {
  const day = store.today(), r = daily.get(id), cur = r && r.day === day ? r.n : 0;
  daily.set(id, { day, n: cur + 1 });
  return cur + 1 > max;
}
const okUrl = (u) => typeof u === "string" && /^https:\/\/queue\.fal\.run\//.test(u);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const key = process.env.FAL_KEY;
  if (!key) return res.status(503).json({ error: "AI video is not set up (FAL_KEY missing)" });
  const who = await store.whoFromHeader(req.headers.authorization);
  if (!who) return res.status(401).json({ error: "Sign in to make an AI video" });
  if (await store.isBlocked(who.email)) return res.status(403).json({ error: "Your access has been blocked." });
  const b = req.body || {}, H = { Authorization: "Key " + key, "content-type": "application/json" };
  try {
    if (b.action === "start") {
      const prompt = store.clip(b.prompt, 800);
      if (!prompt) return res.status(400).json({ error: "Describe the video first" });
      if (store.limited("va:" + store.ipOf(req), 6, 600000)) return res.status(429).json({ error: "Too many requests" });
      if (bump(who.email, Number(process.env.VIDEO_AI_DAILY_LIMIT || 2))) return res.status(429).json({ error: "Daily AI video limit reached. Try again tomorrow." });
      const model = process.env.FAL_VIDEO_MODEL || "fal-ai/ltx-video";
      const r = await fetch("https://queue.fal.run/" + model, { method: "POST", headers: H, body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(20000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.status_url) return res.status(502).json({ error: "AI video service said no" + (d.detail ? ": " + String(typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail)).slice(0, 120) : "") });
      await store.track(req, { who, feature: "aivideo", prompt, ok: true, via: model });
      return res.status(200).json({ status_url: d.status_url, response_url: d.response_url });
    }
    if (b.action === "status") {
      if (!okUrl(b.status_url) || !okUrl(b.response_url)) return res.status(400).json({ error: "Bad request" });
      const s = await fetch(b.status_url, { headers: H, signal: AbortSignal.timeout(15000) });
      const sd = await s.json().catch(() => ({}));
      if (!s.ok) return res.status(502).json({ error: "Could not check the video" });
      if (sd.status !== "COMPLETED") return res.status(200).json({ done: false, status: sd.status || "IN_QUEUE" });
      const r = await fetch(b.response_url, { headers: H, signal: AbortSignal.timeout(15000) });
      const d = await r.json().catch(() => ({}));
      const url = d && d.video && (d.video.url || d.video);
      if (!r.ok || typeof url !== "string") return res.status(502).json({ error: "The video failed. Try a different description." });
      return res.status(200).json({ done: true, url });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(502).json({ error: "AI video is busy. Try again." });
  }
};
