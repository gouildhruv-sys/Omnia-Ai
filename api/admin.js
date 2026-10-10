// Admin API. Protected by ADMIN_PASSWORD (set it in Vercel). Never exposes keys.
const crypto = require("crypto");
const S = require("./_store.js");

function same(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const hmap = (arr) => { const o = {}; if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const days = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)); return out; };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).json({ error: "Admin is off. Add ADMIN_PASSWORD in Vercel, then redeploy." });
  const ip = S.ipOf(req);
  if (S.limited("adm:" + ip, 40, 600000)) return res.status(429).json({ error: "Too many tries. Wait 10 minutes." });
  if (!same(req.headers["x-admin-key"] || "", pw)) return res.status(401).json({ error: "Wrong admin password" });
  const b = req.body || {}, a = b.action;
  if (a === "ping") return res.status(200).json({ ok: true, db: S.dbOn(), accounts: S.accountsOn() });
  if (a === "system") {
    const e = process.env;
    return res.status(200).json({
      database: S.dbOn(), accounts: S.accountsOn(), sessionSecret: !!e.SESSION_SECRET,
      gemini: !!e.GEMINI_API_KEY, groq: !!e.GROQ_API_KEY, mistral: !!e.MISTRAL_API_KEY, openrouter: !!e.OPENROUTER_API_KEY, cerebras: !!e.CEREBRAS_API_KEY,
      cloudflareImages: !!(e.CF_ACCOUNT_ID && e.CF_API_TOKEN), pollinations: !!e.POLLINATIONS_KEY, falVideo: !!e.FAL_KEY, google: !!e.GOOGLE_CLIENT_ID,
      limits: { guestDaily: Number(e.GUEST_DAILY_LIMIT || 8), userDaily: Number(e.DAILY_LIMIT || 60), imageDaily: Number(e.IMAGE_DAILY_LIMIT || 20), guestImage: Number(e.GUEST_IMAGE_LIMIT || 3) },
    });
  }
  if (!S.dbOn()) return res.status(503).json({ error: "Database is not connected. Add the Upstash keys in Vercel." });
  try {
    if (a === "overview") {
      const d = days(7);
      const cmds = [["HLEN", "omnia:users"], ["HLEN", "omnia:gcnt"], ["SCARD", "omnia:blocked"]];
      d.forEach((x) => { cmds.push(["HGETALL", "omnia:s:" + x], ["SCARD", "omnia:a:" + x]); });
      const r = await S.pipe(cmds, 8000);
      const series = d.map((x, i) => ({ day: x, stats: hmap(r[3 + i * 2]), active: r[4 + i * 2] || 0 })).reverse();
      return res.status(200).json({ users: r[0] || 0, guests: r[1] || 0, blocked: r[2] || 0, series });
    }
    if (a === "users") {
      const r = await S.pipe([["HGETALL", "omnia:users"], ["HGETALL", "omnia:cnt"], ["HGETALL", "omnia:last"], ["SMEMBERS", "omnia:blocked"]], 8000);
      const users = hmap(r[0]), cnt = hmap(r[1]), last = hmap(r[2]), blocked = new Set(r[3] || []);
      const list = Object.keys(users).map((k) => { let u = {}; try { u = JSON.parse(users[k]); } catch (e) {} return Object.assign(u, { email: k, count: Number(cnt[k] || 0), last: Number(last[k] || 0), blocked: blocked.has(k) }); });
      list.sort((x, y) => (y.joined || 0) - (x.joined || 0));
      return res.status(200).json({ users: list.slice(0, 1000) });
    }
    if (a === "guests") {
      const r = await S.pipe([["HGETALL", "omnia:gcnt"], ["HGETALL", "omnia:glast"], ["SMEMBERS", "omnia:blocked"]], 8000);
      const cnt = hmap(r[0]), last = hmap(r[1]), blocked = new Set(r[2] || []);
      const list = Object.keys(cnt).map((k) => { let l = {}; try { l = JSON.parse(last[k]); } catch (e) {} return { id: k, count: Number(cnt[k]), last: l.t || 0, country: l.country || "", city: l.city || "", blocked: blocked.has(k) }; });
      list.sort((x, y) => y.last - x.last);
      return res.status(200).json({ guests: list.slice(0, 300) });
    }
    if (a === "activity") {
      const n = Math.min(Number(b.limit) || 200, 500);
      const rows = (await S.cmd("LRANGE", "omnia:act", 0, n - 1)) || [];
      const list = rows.map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      return res.status(200).json({ activity: list });
    }
    const id = S.clip(b.id, 254);
    if (a === "block" || a === "unblock") {
      if (!id) return res.status(400).json({ error: "Missing id" });
      await S.cmd(a === "block" ? "SADD" : "SREM", "omnia:blocked", id);
      return res.status(200).json({ ok: true });
    }
    if (a === "deleteuser") {
      if (!id) return res.status(400).json({ error: "Missing id" });
      await S.pipe([["HDEL", "omnia:users", id], ["HDEL", "omnia:pw", id], ["HDEL", "omnia:cnt", id], ["HDEL", "omnia:last", id]], 6000);
      return res.status(200).json({ ok: true });
    }
    if (a === "resetpw") {
      if (!id) return res.status(400).json({ error: "Missing id" });
      const exists = await S.cmd("HEXISTS", "omnia:pw", id);
      if (exists !== 1) return res.status(404).json({ error: "This user has no password (Google account?)" });
      const temp = crypto.randomBytes(5).toString("hex");
      await S.cmd("HSET", "omnia:pw", id, S.hashPw(temp));
      return res.status(200).json({ ok: true, temp });
    }
    if (a === "announce") {
      const text = S.clip(b.text, 240);
      if (text) await S.cmd("SET", "omnia:ann", text); else await S.cmd("DEL", "omnia:ann");
      S.setAnnCache(text);
      return res.status(200).json({ ok: true });
    }
    if (a === "getannounce") return res.status(200).json({ text: (await S.cmd("GET", "omnia:ann")) || "" });
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: "Database problem: " + String(e.message || e).slice(0, 120) });
  }
};
