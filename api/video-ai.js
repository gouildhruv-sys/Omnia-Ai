// Real AI video through Agnes AI. Turns on only when AGNES_API_KEY is set in Vercel.
const store = require("./_store.js");
const daily = new Map();
function bump(id, max) {
  const day = store.today(), r = daily.get(id), cur = r && r.day === day ? r.n : 0;
  daily.set(id, { day, n: cur + 1 });
  return cur + 1 > max;
}
const okId = (v) => typeof v === "string" && /^[\w.\-]{1,120}$/.test(v);
const pick = (d) => (d && d.data && typeof d.data === "object" ? { ...d, ...d.data } : d) || {};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const key = process.env.AGNES_API_KEY;
  if (!key) return res.status(503).json({ error: "AI video is not set up (AGNES_API_KEY missing)" });
  const who = await store.whoFromHeader(req.headers.authorization);
  if (!who) return res.status(401).json({ error: "Sign in to make an AI video" });
  if (await store.isBlocked(who.email)) return res.status(403).json({ error: "Your access has been blocked." });
  const b = req.body || {}, H = { Authorization: "Bearer " + key, "content-type": "application/json" };
  const model = process.env.AGNES_VIDEO_MODEL || "agnes-video-2.5";
  try {
    if (b.action === "start") {
      const prompt = store.clip(b.prompt, 800);
      if (!prompt) return res.status(400).json({ error: "Describe the video first" });
      if (store.limited("va:" + store.ipOf(req), 6, 600000)) return res.status(429).json({ error: "Too many requests" });
      if (bump(who.email, Number(process.env.VIDEO_AI_DAILY_LIMIT || 2))) return res.status(429).json({ error: "Daily AI video limit reached. Try again tomorrow." });
      const r = await fetch("https://apihub.agnes-ai.com/v1/videos", {
        method: "POST", headers: H,
        body: JSON.stringify({ model, prompt, seconds: "5", mode: "text", size: "720P", aspect_ratio: "16:9" }),
        signal: AbortSignal.timeout(20000),
      });
      const d = pick(await r.json().catch(() => ({})));
      const id = d.id || d.video_id || d.task_id;
      if (!r.ok || !id) {
        console.log("AGNES START", r.status, JSON.stringify(d).slice(0, 300));
        return res.status(502).json({ error: "AI video service said no" });
      }
      await store.track(req, { who, feature: "aivideo", prompt, ok: true, via: model });
      return res.status(200).json({ status_url: String(id), response_url: String(id) });
    }
    if (b.action === "status") {
      if (!okId(b.status_url)) return res.status(400).json({ error: "Bad request" });
      const s = await fetch("https://apihub.agnes-ai.com/agnesapi?video_id=" + encodeURIComponent(b.status_url) + "&model_name=" + encodeURIComponent(model), { headers: H, signal: AbortSignal.timeout(15000) });
      const sd = pick(await s.json().catch(() => ({})));
      if (!s.ok) return res.status(502).json({ error: "Could not check the video" });
      const st = String(sd.status || "").toLowerCase();
      const url = sd.video_url || sd.url || (sd.video && (sd.video.url || sd.video)) || (sd.output && (sd.output.url || sd.output.video_url)) || (Array.isArray(sd.output) ? sd.output[0] : null);
      if (/fail|error|cancel/.test(st)) return res.status(502).json({ error: "The video failed. Try a different description." });
      if (typeof url === "string" && /^https?:\/\//.test(url)) return res.status(200).json({ done: true, url });
      if (/complet|succe|done/.test(st)) {
        console.log("AGNES STATUS (no url found)", JSON.stringify(sd).slice(0, 400));
        return res.status(502).json({ error: "The video failed. Try a different description." });
      }
      return res.status(200).json({ done: false, status: sd.status || "IN_QUEUE" });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(502).json({ error: "AI video is busy. Try again." });
  }
};
