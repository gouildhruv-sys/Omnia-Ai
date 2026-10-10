// Counts ad views and clicks (public, rate limited).
const S = require("./_store.js");
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const b = req.body || {};
  if (S.limited("ad:" + S.ipOf(req), 60, 600000)) return res.status(429).json({ ok: false });
  await S.trackAd(String(b.id || ""), b.type === "c" ? "c" : "v");
  return res.status(200).json({ ok: true });
};
