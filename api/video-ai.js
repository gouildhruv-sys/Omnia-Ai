// HeyGen AI video (talking avatar). Key stays on the server: set HEYGEN_API_KEY in Vercel.
// POST {action:"avatars"|"voices"|"create"|"status", ...}. Signed-in users only, daily cap per user.
const S = require("./_store.js");
const H = "https://api.heygen.com";
const hg = async (path, opt) => {
  const r = await fetch(H + path, Object.assign({ signal: AbortSignal.timeout(20000) }, opt, {
    headers: { "X-Api-Key": process.env.HEYGEN_API_KEY, "content-type": "application/json" },
  }));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d.error && (d.error.message || d.error)) || d.message || "HeyGen error " + r.status); e.status = r.status; throw e; }
  return d;
};
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.HEYGEN_API_KEY) return res.status(503).json({ error: "Video AI is off. Add HEYGEN_API_KEY in Vercel." });
  const who = await S.whoFromHeader(req.headers.authorization);
  if (!who) return res.status(401).json({ error: "Please sign in" });
  if (await S.isBlocked(who.email)) return res.status(403).json({ error: "Your access has been blocked." });
  if (S.limited("hgp:" + S.ipOf(req), 30, 600000)) return res.status(429).json({ error: "Too many requests" });
  const b = req.body || {};
  try {
    if (b.action === "avatars") { const d = await hg("/v2/avatars"); return res.status(200).json({ avatars: ((d.data && d.data.avatars) || []).slice(0, 40).map((x) => ({ id: x.avatar_id, name: x.avatar_name, preview: x.preview_image_url })) }); }
    if (b.action === "voices") { const d = await hg("/v2/voices"); return res.status(200).json({ voices: ((d.data && d.data.voices) || []).slice(0, 80).map((x) => ({ id: x.voice_id, name: x.name, language: x.language, gender: x.gender })) }); }
    if (b.action === "status") {
      const id = String(b.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
      if (!id) return res.status(400).json({ error: "Missing id" });
      const d = (await hg("/v1/video_status.get?video_id=" + id)).data || {};
      return res.status(200).json({ status: d.status, url: d.video_url || "", thumb: d.thumbnail_url || "", error: d.error ? String(d.error.message || d.error).slice(0, 120) : "" });
    }
    if (b.action === "create") {
      const text = String(b.text || "").trim().slice(0, 1500), avatar = String(b.avatar || ""), voice = String(b.voice || "");
      if (!text || !avatar || !voice) return res.status(400).json({ error: "Need text, avatar and voice" });
      if (S.limited("hgd:" + who.email, Number(process.env.HEYGEN_DAILY_LIMIT || 3), 86400000)) return res.status(429).json({ error: "Daily video limit reached" });
      const wide = b.shape !== "tall";
      const d = await hg("/v2/video/generate", { method: "POST", body: JSON.stringify({
        video_inputs: [{ character: { type: "avatar", avatar_id: avatar, avatar_style: "normal" }, voice: { type: "text", input_text: text, voice_id: voice } }],
        dimension: wide ? { width: 1280, height: 720 } : { width: 720, height: 1280 },
      }) });
      const id = d.data && d.data.video_id;
      if (!id) return res.status(502).json({ error: "HeyGen gave no video id" });
      await S.track(req, { who, feature: "video", prompt: text, q: text, a: "[AI video started]", ok: true, via: "heygen" });
      return res.status(200).json({ id });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) { return res.status(502).json({ error: "HeyGen" + (e.status ? " (" + e.status + ")" : "") + ": " + String(e.message || e).slice(0, 160) }); }
};
