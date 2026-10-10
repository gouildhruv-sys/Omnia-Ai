// Sign up / sign in with email + password, and profile details.
const S = require("./_store.js");

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const INTERESTS = ["YouTuber", "Instagram creator", "Student", "Business owner", "Developer", "Other"];

function cleanProfile(b) {
  return {
    name: S.clip(b.name, 60),
    phone: S.clip(b.phone, 20).replace(/[^\d+\-\s]/g, ""),
    interest: INTERESTS.includes(b.interest) ? b.interest : "Other",
    city: S.clip(b.city, 40),
  };
}
async function loadUser(email) {
  const raw = await S.cmd("HGET", "omnia:users", email);
  return raw ? JSON.parse(raw) : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!S.dbOn()) return res.status(503).json({ error: "Accounts are not set up yet (admin: add the database keys)" });
  const b = req.body || {}, ip = S.ipOf(req), action = b.action;
  try {
    if (action === "signup") {
      if (!S.accountsOn()) return res.status(503).json({ error: "Accounts need SESSION_SECRET on the server" });
      if (S.limited("su:" + ip, 8, 600000)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
      const email = S.clip(b.email, 254).toLowerCase(), pw = String(b.password || "");
      const p = cleanProfile(b);
      if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email" });
      if (p.name.length < 2) return res.status(400).json({ error: "Enter your name" });
      if (pw.length < 6 || pw.length > 100) return res.status(400).json({ error: "Password must be at least 6 characters" });
      const pl = S.place(req);
      const user = Object.assign({ email, joined: Date.now(), country: pl.country, loc: pl.city, method: "email" }, p);
      const made = await S.cmd("HSETNX", "omnia:users", email, JSON.stringify(user));
      if (made !== 1) return res.status(409).json({ error: "This email already has an account. Sign in instead." });
      await S.cmd("HSET", "omnia:pw", email, S.hashPw(pw));
      const s = S.signSession(email, p.name);
      return res.status(200).json({ token: s.token, exp: s.exp, user: { name: p.name, email } });
    }
    if (action === "login") {
      const email = S.clip(b.email, 254).toLowerCase(), pw = String(b.password || "");
      if (S.limited("li:" + ip, 12, 600000) || S.limited("le:" + email, 8, 600000)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
      const stored = await S.cmd("HGET", "omnia:pw", email);
      if (!stored || !S.checkPw(pw, stored)) return res.status(401).json({ error: "Wrong email or password" });
      if (await S.isBlocked(email)) return res.status(403).json({ error: "This account is blocked. Contact support." });
      const u = await loadUser(email);
      const s = S.signSession(email, u ? u.name : email);
      return res.status(200).json({ token: s.token, exp: s.exp, user: { name: u ? u.name : email, email } });
    }
    // everything below needs a signed-in person (email account or Google)
    const who = await S.whoFromHeader(req.headers.authorization);
    if (!who) return res.status(401).json({ error: "Please sign in" });
    if (await S.isBlocked(who.email)) return res.status(403).json({ error: "This account is blocked. Contact support." });
    if (action === "me") {
      const u = await loadUser(who.email);
      return res.status(200).json({ profile: u ? { name: u.name, phone: u.phone, interest: u.interest, city: u.city } : null });
    }
    if (action === "deletechats") {
      await S.pipe([["DEL", "omnia:cv:" + who.email], ["HDEL", "omnia:cvl", who.email]], 5000);
      return res.status(200).json({ ok: true });
    }
    if (action === "update") {
      const p = cleanProfile(b);
      if (p.name.length < 2) return res.status(400).json({ error: "Enter your name" });
      const old = (await loadUser(who.email)) || { email: who.email, joined: Date.now(), method: who.kind === "google" ? "google" : "email" };
      const pl = S.place(req);
      const u = Object.assign({}, old, p, { country: old.country || pl.country, loc: old.loc || pl.city });
      await S.cmd("HSET", "omnia:users", who.email, JSON.stringify(u));
      return res.status(200).json({ ok: true, profile: p });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: "Server problem. Try again." });
  }
};
