// OPTIONAL real AI video through fal.ai. Turns on only when FAL_KEY is set in Vercel.
// Uses paid credits, so it is limited per signed-in person (VIDEO_AI_DAILY_LIMIT, default 2) and guests are not allowed.
// Default model: lightricks/ltx-2.5/text-to-video/fast (LTX 2.5 Fast). Optional variables: FAL_VIDEO_MODEL, FAL_VIDEO_RES (720p), FAL_VIDEO_SECONDS (6), FAL_VIDEO_AUDIO (1 or 0).
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
