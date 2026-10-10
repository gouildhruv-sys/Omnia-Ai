// Shared helpers: database (Upstash Redis REST), login sessions, passwords, activity tracking.
// Private file (starts with _), not a public endpoint.
const crypto = require("crypto");

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/$/, "");
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const SECRET = process.env.SESSION_SECRET || "";
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || "";

const dbOn = () => !!(URL_ && TOK);
const accountsOn = () => dbOn() && SECRET.length >= 16;

async function pipe(cmds, ms) {
  if (!dbOn()) throw new Error("db off");
  const r = await fetch(URL_ + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOK, "content-type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map((x) => String(x)))),
    signal: AbortSignal.timeout(ms || 4000),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d)) throw new Error("db error " + r.status);
  return d.map((x) => { if (x && x.error) throw new Error(x.error); return x.result; });
}
async function cmd(...c) { return (await pipe([c]))[0]; }

// ---- sessions (signed tokens) ----
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
function signSession(email, name, days) {
  const exp = Math.floor(Date.now() / 1000) + 86400 * (days || 30);
  const body = b64u(JSON.stringify({ email, name, exp }));
  const sig = b64u(crypto.createHmac("sha256", SECRET).update(body).digest());
  return { token: "omnia." + body + "." + sig, exp };
}
function verifySession(token) {
  try {
    if (!SECRET) return null;
    const parts = String(token).split(".");
    if (parts.length !== 3 || parts[0] !== "omnia") return null;
    const sig = b64u(crypto.createHmac("sha256", SECRET).update(parts[1]).digest());
    const a = Buffer.from(sig), b = Buffer.from(parts[2]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(unb64u(parts[1]).toString("utf8"));
    if (!p.email || p.exp * 1000 < Date.now()) return null;
    return { email: p.email, name: p.name, kind: "acct" };
  } catch (e) { return null; }
}

// ---- Google ----
const gcache = new Map();
async function verifyGoogle(token) {
  if (!GOOGLE_ID) return null;
  const c = gcache.get(token);
  if (c && c.until > Date.now()) return c.who;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
    if (!r.ok) return null;
    const d = await r.json();
    if (d.aud !== GOOGLE_ID || Number(d.exp) * 1000 < Date.now()) return null;
    if (d.email_verified !== "true" && d.email_verified !== true) return null;
    const who = { email: String(d.email).toLowerCase(), name: d.name, kind: "google" };
    gcache.set(token, { who, until: Math.min(Number(d.exp) * 1000, Date.now() + 300000) });
    return who;
  } catch (e) { return null; }
}
async function whoFromHeader(auth) {
  auth = String(auth || "");
  if (auth.startsWith("Bearer omnia.")) return verifySession(auth.slice(7));
  if (auth.startsWith("Bearer ")) return verifyGoogle(auth.slice(7));
  return null;
}

// ---- passwords ----
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(String(pw), salt, 32).toString("hex");
}
function checkPw(pw, stored) {
  try {
    const [salt, h] = String(stored).split(":");
    const x = crypto.scryptSync(String(pw), salt, 32);
    const y = Buffer.from(h, "hex");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch (e) { return false; }
}

// ---- helpers ----
const today = () => new Date().toISOString().slice(0, 10);
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
function ipOf(req) { return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown"; }
function guestId(req) { return "g:" + crypto.createHash("sha256").update(ipOf(req) + "|omnia").digest("hex").slice(0, 8); }
function place(req) {
  const h = req.headers || {};
  let city = ""; try { city = decodeURIComponent(h["x-vercel-ip-city"] || ""); } catch (e) {}
  return { country: clip(h["x-vercel-ip-country"], 4), city: clip(city, 40) };
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function isBlocked(id) {
  if (!dbOn()) return false;
  try { return (await withTimeout(cmd("SISMEMBER", "omnia:blocked", id), 1500)) === 1; } catch (e) { return false; }
}

// Record one action. Never throws and never slows the app for more than ~1.5s.
async function track(req, o) {
  if (!dbOn()) return;
  try {
    const id = o.who ? o.who.email : guestId(req), day = today(), pl = place(req);
    const feature = clip(o.feature || "chat", 16) || "chat";
    const row = JSON.stringify({ t: Date.now(), id, name: o.who ? clip(o.who.name, 40) : "Guest", feature, prompt: clip(o.prompt, 160), ok: o.ok !== false, via: clip(o.via, 40), country: pl.country, city: pl.city });
    const c = [
      ["LPUSH", "omnia:act", row], ["LTRIM", "omnia:act", 0, 1499],
      ["HINCRBY", "omnia:s:" + day, feature, 1], ["HINCRBY", "omnia:s:" + day, "total", 1],
      ["SADD", "omnia:a:" + day, id],
    ];
    if (o.who) { c.push(["HINCRBY", "omnia:cnt", id, 1], ["HSET", "omnia:last", id, Date.now()]); }
    else { c.push(["HINCRBY", "omnia:gcnt", id, 1], ["HSET", "omnia:glast", id, JSON.stringify({ t: Date.now(), country: pl.country, city: pl.city })]); }
    await withTimeout(pipe(c, 1500), 1600);
  } catch (e) {}
}

let annCache = { v: "", t: 0 };
async function announcement() {
  if (!dbOn()) return "";
  if (Date.now() - annCache.t < 30000) return annCache.v;
  try { annCache = { v: (await withTimeout(cmd("GET", "omnia:ann"), 1500)) || "", t: Date.now() }; } catch (e) {}
  return annCache.v;
}
function setAnnCache(v) { annCache = { v, t: Date.now() }; }

// tiny in-memory rate limiter
const rl = new Map();
function limited(key, max, ms) {
  const now = Date.now(), arr = (rl.get(key) || []).filter((t) => now - t < ms);
  arr.push(now); rl.set(key, arr);
  return arr.length > max;
}

module.exports = { dbOn, accountsOn, pipe, cmd, signSession, verifySession, verifyGoogle, whoFromHeader, hashPw, checkPw, today, clip, ipOf, guestId, place, isBlocked, track, announcement, setAnnCache, limited, GOOGLE_ID };
