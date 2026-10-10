// Admin API. Protected by ADMIN_PASSWORD (set it in Vercel). Never exposes keys.
const crypto = require("crypto");
const S = require("./_store.js");
const P = require("./_plan.js");

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
    const e = process.env, cfg = await P.getCfg();
    return res.status(200).json({
      database: S.dbOn(), accounts: S.accountsOn(), sessionSecret: !!e.SESSION_SECRET,
      gemini: !!e.GEMINI_API_KEY, groq: !!e.GROQ_API_KEY, mistral: !!e.MISTRAL_API_KEY, openrouter: !!e.OPENROUTER_API_KEY, cerebras: !!e.CEREBRAS_API_KEY,
      cloudflareImages: !!(e.CF_ACCOUNT_ID && e.CF_API_TOKEN), pollinations: !!e.POLLINATIONS_KEY, google: !!e.GOOGLE_CLIENT_ID,
      chatLog: e.CHAT_LOG !== "0", retentionDays: Number(e.CHAT_RETENTION_DAYS || 30), cooldownSec: cfg.cooldownSec, payUrl: !!cfg.premium.payUrl,
    });
  }
  if (!S.dbOn()) return res.status(503).json({ error: "Database is not connected. Add the Upstash keys in Vercel." });
  try {
    if (a === "overview") {
      const d = days(7);
      const cmds = [["HLEN", "omnia:users"], ["HLEN", "omnia:gcnt"], ["SCARD", "omnia:blocked"], ["HLEN", "omnia:cvl"], ["HVALS", "omnia:last"], ["HVALS", "omnia:glast"]];
      d.forEach((x) => { cmds.push(["HGETALL", "omnia:s:" + x], ["SCARD", "omnia:a:" + x]); });
      const r = await S.pipe(cmds, 8000);
      const series = d.map((x, i) => ({ day: x, stats: hmap(r[6 + i * 2]), active: r[7 + i * 2] || 0 })).reverse();
      const cut = Date.now() - 300000;
      let online = (r[4] || []).filter((t) => Number(t) > cut).length;
      (r[5] || []).forEach((v) => { try { if (JSON.parse(v).t > cut) online++; } catch (e) {} });
      return res.status(200).json({ users: r[0] || 0, guests: r[1] || 0, blocked: r[2] || 0, chats: r[3] || 0, online, series });
    }
    if (a === "chatusers") {
      const r = await S.pipe([["HGETALL", "omnia:cvl"]], 8000);
      const m = hmap(r[0]), ids = Object.keys(m);
      const lens = ids.length ? await S.pipe(ids.slice(0, 400).map((k) => ["LLEN", "omnia:cv:" + k]), 8000) : [];
      const list = ids.slice(0, 400).map((k, i) => { let l = {}; try { l = JSON.parse(m[k]); } catch (e) {} return { id: k, name: l.name || k, t: l.t || 0, country: l.country || "", city: l.city || "", count: lens[i] || 0 }; }).filter((x) => x.count > 0);
      list.sort((x, y) => y.t - x.t);
      return res.status(200).json({ chats: list });
    }
    if (a === "chat") {
      const id0 = S.clip(b.id, 254);
      if (!id0) return res.status(400).json({ error: "Missing id" });
      const rows = (await S.cmd("LRANGE", "omnia:cv:" + id0, 0, 149)) || [];
      const list = rows.map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean).reverse();
      return res.status(200).json({ messages: list });
    }
    if (a === "delchat") {
      const id1 = S.clip(b.id, 254);
      if (!id1) return res.status(400).json({ error: "Missing id" });
      await S.pipe([["DEL", "omnia:cv:" + id1], ["HDEL", "omnia:cvl", id1]], 5000);
      return res.status(200).json({ ok: true });
    }
    if (a === "ads") {
      const r = await S.pipe([["HGETALL", "omnia:ads"], ["HGETALL", "omnia:adst"]], 8000);
      const ads = hmap(r[0]), st = hmap(r[1]);
      const list = Object.keys(ads).map((k) => { let x = {}; try { x = JSON.parse(ads[k]); } catch (e) {} return Object.assign(x, { id: k, views: Number(st[k + ":v"] || 0), clicks: Number(st[k + ":c"] || 0) }); });
      list.sort((x, y) => (y.created || 0) - (x.created || 0));
      return res.status(200).json({ ads: list });
    }
    if (a === "adsave") {
      const ad = b.ad || {};
      const url = S.clip(ad.url, 400), img = S.clip(ad.img, 400);
      if (!/^https:\/\//.test(url)) return res.status(400).json({ error: "The link must start with https://" });
      if (img && !/^https:\/\//.test(img)) return res.status(400).json({ error: "The picture link must start with https://" });
      const title = S.clip(ad.title, 60);
      if (!title) return res.status(400).json({ error: "Add a title" });
      const id2 = /^[a-z0-9]{4,20}$/.test(String(ad.id || "")) ? ad.id : crypto.randomBytes(5).toString("hex");
      let old = {}; try { old = JSON.parse((await S.cmd("HGET", "omnia:ads", id2)) || "{}"); } catch (e) {}
      const dayMs = (v, endOfDay) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "")); if (!m) return 0; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + (endOfDay ? 86399999 : 0); return Number.isFinite(t) ? t : 0; };
      const rec = { id: id2, title, text: S.clip(ad.text, 140), cta: S.clip(ad.cta, 20) || "Learn more", url, img, who: ad.who === "guests" ? "guests" : "all", on: ad.on !== false, created: old.created || Date.now(), start: dayMs(ad.startDay, false), end: dayMs(ad.endDay, true), maxViews: Math.min(10000000, Math.max(0, Math.round(Number(ad.maxViews) || 0))) };
      await S.cmd("HSET", "omnia:ads", id2, JSON.stringify(rec));
      S.resetAdCache();
      return res.status(200).json({ ok: true, id: id2 });
    }
    if (a === "adtoggle" || a === "addel") {
      const id3 = S.clip(b.id, 40);
      if (!/^[a-z0-9]{4,20}$/.test(id3)) return res.status(400).json({ error: "Bad id" });
      if (a === "addel") await S.pipe([["HDEL", "omnia:ads", id3], ["HDEL", "omnia:adst", id3 + ":v"], ["HDEL", "omnia:adst", id3 + ":c"]], 5000);
      else { let x = {}; try { x = JSON.parse((await S.cmd("HGET", "omnia:ads", id3)) || "{}"); } catch (e) {} x.on = !x.on; await S.cmd("HSET", "omnia:ads", id3, JSON.stringify(x)); }
      S.resetAdCache();
      return res.status(200).json({ ok: true });
    }
    if (a === "users") {
      const r = await S.pipe([["HGETALL", "omnia:users"], ["HGETALL", "omnia:cnt"], ["HGETALL", "omnia:last"], ["SMEMBERS", "omnia:blocked"], ["HGETALL", "omnia:prem"], ["HGETALL", "omnia:notes"]], 8000);
      const users = hmap(r[0]), cnt = hmap(r[1]), last = hmap(r[2]), blocked = new Set(r[3] || []), prem = hmap(r[4]), notes = hmap(r[5]);
      const list = Object.keys(users).map((k) => { let u = {}; try { u = JSON.parse(users[k]); } catch (e) {} return Object.assign(u, { email: k, count: Number(cnt[k] || 0), last: Number(last[k] || 0), blocked: blocked.has(k), premium: Number(prem[k] || 0), note: notes[k] || "" }); });
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
    if (a === "getcfg") return res.status(200).json({ cfg: await P.getCfg(), features: P.FEATURES });
    if (a === "setcfg") { const c = await P.saveCfg(b.cfg || {}); return res.status(200).json({ ok: true, cfg: c }); }
    if (a === "chatsearch") {
      const q = S.clip(b.q, 60).toLowerCase();
      if (q.length < 2) return res.status(400).json({ error: "Type at least 2 letters" });
      const idx = hmap((await S.pipe([["HGETALL", "omnia:cvl"]], 8000))[0]);
      const ids = Object.keys(idx).map((k) => { let l = {}; try { l = JSON.parse(idx[k]); } catch (e) {} return { id: k, name: l.name || k, t: l.t || 0 }; }).sort((x, y) => y.t - x.t).slice(0, 80);
      const lists = ids.length ? await S.pipe(ids.map((u) => ["LRANGE", "omnia:cv:" + u.id, 0, 59]), 9000) : [];
      const hits = [];
      ids.forEach((u, i) => { (lists[i] || []).forEach((x) => { let m = null; try { m = JSON.parse(x); } catch (e) {} if (m && ((m.q || "").toLowerCase().includes(q) || (m.a || "").toLowerCase().includes(q))) hits.push({ id: u.id, name: u.name, t: m.t, f: m.f, q: S.clip(m.q, 140), a: S.clip(m.a, 140) }); }); });
      hits.sort((x, y) => y.t - x.t);
      return res.status(200).json({ hits: hits.slice(0, 60), scanned: ids.length });
    }
    if (a === "blocked") {
      const ids = (await S.cmd("SMEMBERS", "omnia:blocked")) || [];
      return res.status(200).json({ blocked: ids.slice(0, 500) });
    }
    if (a === "premlist") {
      const r = await S.pipe([["HGETALL", "omnia:prem"], ["HGETALL", "omnia:users"]], 8000);
      const prem = hmap(r[0]), users = hmap(r[1]), now = Date.now();
      const list = Object.keys(prem).map((k) => { let u = {}; try { u = JSON.parse(users[k] || "{}"); } catch (e) {} return { email: k, name: u.name || k, until: Number(prem[k]), active: Number(prem[k]) > now }; });
      list.sort((x, y) => y.until - x.until);
      return res.status(200).json({ premium: list });
    }
    if (a === "premgrant") {
      const id = S.clip(b.id, 254).toLowerCase(), days = Math.min(365, Math.max(1, Math.round(Number(b.days) || 0)));
      if (!id || !days) return res.status(400).json({ error: "Enter an email and number of days" });
      const exists = await S.cmd("HEXISTS", "omnia:users", id);
      if (exists !== 1) return res.status(404).json({ error: "No account with this email" });
      return res.status(200).json({ ok: true, until: await P.addPremium(id, days) });
    }
    if (a === "premrevoke") { await P.revokePremium(S.clip(b.id, 254).toLowerCase()); return res.status(200).json({ ok: true }); }
    if (a === "refs") {
      const r = await S.pipe([["HGETALL", "omnia:refn"], ["HGETALL", "omnia:refd"], ["HGETALL", "omnia:users"]], 8000);
      const n = hmap(r[0]), d = hmap(r[1]), users = hmap(r[2]);
      const list = Object.keys(n).map((k) => { let u = {}; try { u = JSON.parse(users[k] || "{}"); } catch (e) {} return { email: k, name: u.name || k, invites: Number(n[k]), days: Number(d[k] || 0) }; });
      list.sort((x, y) => y.invites - x.invites);
      return res.status(200).json({ refs: list.slice(0, 50) });
    }
    if (a === "insights") {
      const rows = ((await S.cmd("LRANGE", "omnia:act", 0, 1499)) || []).map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      const freq = {}, byFeat = {}, fails = [];
      rows.forEach((x) => {
        byFeat[x.feature] = (byFeat[x.feature] || 0) + 1;
        const k = String(x.prompt || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 50);
        if (k.length > 3) freq[k] = (freq[k] || 0) + 1;
        if (x.ok === false && fails.length < 40) fails.push({ t: x.t, name: x.name, feature: x.feature, prompt: x.prompt });
      });
      const top = Object.keys(freq).map((k) => ({ text: k, n: freq[k] })).sort((x, y) => y.n - x.n).slice(0, 15);
      const cnt = hmap(await S.cmd("HGETALL", "omnia:cnt")), users = hmap(await S.cmd("HGETALL", "omnia:users"));
      const topUsers = Object.keys(cnt).map((k) => { let u = {}; try { u = JSON.parse(users[k] || "{}"); } catch (e) {} return { email: k, name: u.name || k, n: Number(cnt[k]) }; }).sort((x, y) => y.n - x.n).slice(0, 10);
      return res.status(200).json({ top, topUsers, fails, byFeat, sample: rows.length });
    }
    if (a === "userdetail") {
      const id = S.clip(b.id, 254);
      if (!id) return res.status(400).json({ error: "Missing id" });
      const r = await S.pipe([["HGETALL", "omnia:uf:" + id], ["HGET", "omnia:notes", id], ["HGET", "omnia:refn", id], ["HGET", "omnia:refof", id]], 6000);
      return res.status(200).json({ usage: hmap(r[0]), note: r[1] || "", invites: Number(r[2]) || 0, invitedBy: r[3] || "", premiumUntil: await P.premiumUntil(id), cooldowns: await P.cooldowns(id) });
    }
    if (a === "usernote") {
      const id = S.clip(b.id, 254), note = S.clip(b.note, 300);
      if (!id) return res.status(400).json({ error: "Missing id" });
      if (note) await S.cmd("HSET", "omnia:notes", id, note); else await S.cmd("HDEL", "omnia:notes", id);
      return res.status(200).json({ ok: true });
    }
    if (a === "resetlimits") {
      const id = S.clip(b.id, 254);
      if (!id) return res.status(400).json({ error: "Missing id" });
      const c = []; P.FEATURES.forEach((f) => { c.push(["DEL", "omnia:cd:" + id + ":" + f], ["DEL", "omnia:q:" + id + ":" + f]); });
      await S.pipe(c, 6000);
      return res.status(200).json({ ok: true });
    }
    if (a === "testproviders") {
      const e = process.env, out = {};
      async function probe(name, url, headers) { try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) }); out[name] = r.ok ? "ok" : "error " + r.status; } catch (x) { out[name] = "no answer"; } }
      const jobs = [];
      if (e.GEMINI_API_KEY) jobs.push(probe("Gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=" + encodeURIComponent(e.GEMINI_API_KEY), {}));
      if (e.GROQ_API_KEY) jobs.push(probe("Groq", "https://api.groq.com/openai/v1/models", { Authorization: "Bearer " + e.GROQ_API_KEY }));
      if (e.MISTRAL_API_KEY) jobs.push(probe("Mistral", "https://api.mistral.ai/v1/models", { Authorization: "Bearer " + e.MISTRAL_API_KEY }));
      if (e.CF_ACCOUNT_ID && e.CF_API_TOKEN) jobs.push(probe("Cloudflare", "https://api.cloudflare.com/client/v4/accounts/" + e.CF_ACCOUNT_ID + "/tokens/verify", { Authorization: "Bearer " + e.CF_API_TOKEN }));
      jobs.push((async () => { try { await S.cmd("PING"); out.Database = "ok"; } catch (x) { out.Database = "no answer"; } })());
      await Promise.all(jobs);
      return res.status(200).json({ results: out });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: "Database problem: " + String(e.message || e).slice(0, 120) });
  }
};
