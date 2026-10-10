// Plans, limits with a cooldown timer, premium, invites. Private helper (starts with _).
const crypto = require("crypto");
const S = require("./_store.js");

const FEATURES = ["chat", "code", "image", "thumb", "video", "vidimg", "tools", "song", "aux"];
// [guest, signed-in, premium]  = uses before the cooldown timer starts
const DEFAULT_CFG = {
  cooldownSec: 300,
  dailyMult: 10,
  limits: {
    chat: [10, 25, 120], code: [3, 8, 40], image: [3, 8, 40], thumb: [3, 8, 40],
    video: [1, 3, 15], vidimg: [4, 12, 60], tools: [6, 15, 80], song: [1, 3, 15], aux: [20, 60, 300],
  },
  off: [],
  maintenance: { on: false, msg: "" },
  premium: { payUrl: "", price: "", note: "", inviteNeed: 2, inviteDays: 1, inviteCapDays: 30 },
};

let cfgCache = { v: null, t: 0 };
function merge(base, add) {
  const out = JSON.parse(JSON.stringify(base));
  if (!add || typeof add !== "object") return out;
  if (Number.isFinite(add.cooldownSec)) out.cooldownSec = Math.min(3600, Math.max(10, Math.round(add.cooldownSec)));
  if (Number.isFinite(add.dailyMult)) out.dailyMult = Math.min(100, Math.max(1, Math.round(add.dailyMult)));
  if (add.limits && typeof add.limits === "object") {
    for (const f of FEATURES) {
      const a = add.limits[f];
      if (Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(n) && n >= 0 && n <= 100000)) out.limits[f] = a.map((n) => Math.round(n));
    }
  }
  if (Array.isArray(add.off)) out.off = add.off.filter((f) => FEATURES.includes(f) || ["song", "tools"].includes(f));
  if (add.maintenance && typeof add.maintenance === "object") out.maintenance = { on: !!add.maintenance.on, msg: S.clip(add.maintenance.msg, 200) };
  if (add.premium && typeof add.premium === "object") {
    const p = add.premium, o = out.premium;
    if (typeof p.payUrl === "string") o.payUrl = /^https:\/\/[^\s"'<>]{4,300}$/.test(p.payUrl.trim()) ? p.payUrl.trim() : "";
    if (typeof p.price === "string") o.price = S.clip(p.price, 60);
    if (typeof p.note === "string") o.note = S.clip(p.note, 160);
    if (Number.isFinite(p.inviteNeed)) o.inviteNeed = Math.min(50, Math.max(1, Math.round(p.inviteNeed)));
    if (Number.isFinite(p.inviteDays)) o.inviteDays = Math.min(30, Math.max(1, Math.round(p.inviteDays)));
    if (Number.isFinite(p.inviteCapDays)) o.inviteCapDays = Math.min(365, Math.max(0, Math.round(p.inviteCapDays)));
  }
  return out;
}
async function getCfg() {
  if (cfgCache.v && Date.now() - cfgCache.t < 20000) return cfgCache.v;
  let saved = null;
  if (S.dbOn()) { try { const r = await S.withTimeout(S.cmd("GET", "omnia:cfg"), 1500); if (r) saved = JSON.parse(r); } catch (e) {} }
  cfgCache = { v: merge(DEFAULT_CFG, saved), t: Date.now() };
  return cfgCache.v;
}
async function saveCfg(patch) {
  const cur = await getCfg();
  const next = merge(cur, patch);
  await S.cmd("SET", "omnia:cfg", JSON.stringify(next));
  cfgCache = { v: next, t: Date.now() };
  return next;
}
function publicCfg(c) {
  return { cooldownSec: c.cooldownSec, limits: c.limits, off: c.off, maintenance: c.maintenance, premium: { payUrl: c.premium.payUrl, price: c.premium.price, note: c.premium.note, inviteNeed: c.premium.inviteNeed, inviteDays: c.premium.inviteDays } };
}

// ---- premium ----
async function premiumUntil(email) {
  if (!email || !S.dbOn()) return 0;
  try { return Number(await S.withTimeout(S.cmd("HGET", "omnia:prem", email), 1500)) || 0; } catch (e) { return 0; }
}
async function isPremium(email) { return (await premiumUntil(email)) > Date.now(); }
async function addPremium(email, days) {
  const cur = await premiumUntil(email), base = Math.max(Date.now(), cur), until = base + Math.round(days * 86400000);
  await S.cmd("HSET", "omnia:prem", email, until);
  return until;
}
async function revokePremium(email) { await S.cmd("HDEL", "omnia:prem", email); }

// ---- invites ----
async function refCodeFor(email) {
  let c = await S.cmd("HGET", "omnia:refc", email);
  if (c) return c;
  for (let i = 0; i < 5; i++) {
    c = crypto.randomBytes(5).toString("hex").slice(0, 7);
    const made = await S.cmd("HSETNX", "omnia:refby", c, email);
    if (made === 1) { await S.cmd("HSET", "omnia:refc", email, c); return c; }
  }
  return "";
}
const ipHash = (ip) => crypto.createHash("sha256").update(String(ip) + "|ref").digest("hex").slice(0, 16);
async function redeemRef(code, newEmail, ip) {
  try {
    code = String(code || "").toLowerCase();
    if (!/^[a-f0-9]{5,8}$/.test(code)) return null;
    const referrer = await S.cmd("HGET", "omnia:refby", code);
    if (!referrer || referrer === newEmail) return null;
    const ih = ipHash(ip), regip = await S.cmd("HGET", "omnia:regip", referrer);
    if (regip && regip === ih) return { skipped: "same network" };
    const fresh = await S.cmd("SADD", "omnia:refips:" + referrer, ih);
    if (fresh !== 1) return { skipped: "already counted" };
    const cfg = await getCfg(), need = cfg.premium.inviteNeed;
    const n = await S.cmd("HINCRBY", "omnia:refn", referrer, 1);
    await S.cmd("HSET", "omnia:refof", newEmail, referrer);
    let granted = 0;
    if (n % need === 0) {
      const have = Number(await S.cmd("HGET", "omnia:refd", referrer)) || 0, days = cfg.premium.inviteDays;
      if (have + days <= cfg.premium.inviteCapDays) { await addPremium(referrer, days); await S.cmd("HINCRBY", "omnia:refd", referrer, days); granted = days; }
    }
    return { referrer, count: n, granted };
  } catch (e) { return null; }
}
async function noteRegIp(email, ip) { try { await S.cmd("HSET", "omnia:regip", email, ipHash(ip)); } catch (e) {} }

// ---- limits with cooldown ----
const mem = new Map(); // fallback when no database
async function checkLimit(req, who, feature) {
  const cfg = await getCfg();
  if (cfg.maintenance.on) return { ok: false, status: 503, code: "maintenance", error: cfg.maintenance.msg || "Omnia is being updated. Please come back soon." };
  if (cfg.off.includes(feature)) return { ok: false, status: 503, code: "off", error: "This feature is switched off for a little while." };
  const lim = cfg.limits[feature];
  if (!lim) return { ok: true };
  const id = who ? who.email : S.guestId(req);
  const premium = who ? await isPremium(who.email) : false;
  const plan = who ? (premium ? 2 : 1) : 0, max = lim[plan];
  if (max <= 0) return { ok: false, status: 403, code: "plan", error: "This feature needs an account or Premium." , plan };
  const qk = "omnia:q:" + id + ":" + feature, ck = "omnia:cd:" + id + ":" + feature, dk = "omnia:dq:" + id + ":" + feature + ":" + S.today();
  const dcap = max * cfg.dailyMult;
  if (!S.dbOn()) {
    const now = Date.now(), m = mem.get(id + feature) || { n: 0, until: 0, d: 0, day: S.today() };
    if (m.day !== S.today()) { m.d = 0; m.day = S.today(); }
    if (m.until > now) return { ok: false, status: 429, code: "cooldown", retry: Math.ceil((m.until - now) / 1000), feature, plan, error: "Limit reached" };
    m.n += 1; m.d += 1; mem.set(id + feature, m);
    if (m.d > dcap) return { ok: false, status: 429, code: "daily", feature, plan, error: "Daily limit reached. Come back tomorrow or get Premium." };
    if (m.n > max) { m.n = 0; m.until = now + cfg.cooldownSec * 1000; return { ok: false, status: 429, code: "cooldown", retry: cfg.cooldownSec, feature, plan, error: "Limit reached" }; }
    return { ok: true, id, feature, plan, left: max - m.n };
  }
  try {
    const ttl = (await S.pipe([["TTL", ck]], 2500))[0];
    if (ttl > 0) return { ok: false, status: 429, code: "cooldown", retry: ttl, feature, plan, error: "Limit reached" };
    const r = await S.pipe([["INCR", qk], ["INCR", dk], ["EXPIRE", qk, 86400], ["EXPIRE", dk, 172800]], 2500);
    if (r[1] > dcap) return { ok: false, status: 429, code: "daily", feature, plan, error: "Daily limit reached. Come back tomorrow or get Premium." };
    if (r[0] > max) {
      await S.pipe([["SET", ck, "1", "EX", cfg.cooldownSec], ["DEL", qk]], 2500);
      return { ok: false, status: 429, code: "cooldown", retry: cfg.cooldownSec, feature, plan, error: "Limit reached" };
    }
    return { ok: true, id, feature, plan, left: max - r[0] };
  } catch (e) { return { ok: true, id, feature, plan }; } // never block people because the database hiccuped
}
async function refund(id, feature) {
  try {
    if (!S.dbOn()) { const m = mem.get(id + feature); if (m && m.n > 0) m.n -= 1; return; }
    await S.pipe([["DECR", "omnia:q:" + id + ":" + feature]], 1500);
  } catch (e) {}
}
async function cooldowns(id) {
  const out = {};
  if (!S.dbOn()) { const now = Date.now(); for (const f of FEATURES) { const m = mem.get(id + f); if (m && m.until > now) out[f] = Math.ceil((m.until - now) / 1000); } return out; }
  try {
    const r = await S.pipe(FEATURES.map((f) => ["TTL", "omnia:cd:" + id + ":" + f]), 2500);
    FEATURES.forEach((f, i) => { if (r[i] > 0) out[f] = r[i]; });
  } catch (e) {}
  return out;
}
function featureOf(body, fallback) {
  const f = typeof body.feature === "string" ? body.feature : "";
  return FEATURES.includes(f) ? f : fallback;
}

module.exports = { FEATURES, DEFAULT_CFG, getCfg, saveCfg, publicCfg, premiumUntil, isPremium, addPremium, revokePremium, refCodeFor, redeemRef, noteRegIp, checkLimit, refund, cooldowns, featureOf };
