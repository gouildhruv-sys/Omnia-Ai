import { r, getJ, setJ, ok, rawCfg } from './_lib.js';
const mask = (k) => (k ? '••••' + k.slice(-4) : '');
export default async function h(req, res) {
  try {
    if (!process.env.ADMIN_PASSWORD || req.headers['x-admin'] !== process.env.ADMIN_PASSWORD) return ok(res, { error: 'Admin password galat' }, 401);
    const b = req.body || {}, E = (b.email || '').toLowerCase(), u = E ? await getJ('u:' + E) : null;
    if (b.action === 'users') {
      const list = await r('SMEMBERS', 'users'); const us = (await Promise.all(list.map((e) => getJ('u:' + e)))).filter(Boolean);
      return ok(res, { users: us.map(({ pass, salt, ...x }) => x).sort((a, c) => c.created - a.created) });
    }
    if (b.action === 'getcfg') {
      const c = await rawCfg(); for (const k in c.models) c.models[k].key = mask(c.models[k].key); c.image.key = mask(c.image.key); c.video.key = mask(c.video.key);
      return ok(res, { cfg: c });
    }
    if (b.action === 'setcfg') {
      const old = await rawCfg(), n = b.cfg, keep = (nw, od) => (String(nw || '').startsWith('••') ? od : String(nw || '').trim());
      for (const k in old.models) n.models[k].key = keep(n.models[k].key, old.models[k].key);
      n.image.key = keep(n.image.key, old.image.key); n.video.key = keep(n.video.key, old.video.key);
      n.promo.days = Math.max(1, +n.promo.days || 3); await setJ('cfg', n); return ok(res, { saved: true });
    }
    if (!u) throw new Error('User nahi mila');
    if (b.action === 'grant') { u.subs ||= {}; if (+b.days > 0) u.subs[b.model] = Math.max(Date.now(), u.subs[b.model] || 0) + b.days * 864e5; else delete u.subs[b.model]; await setJ('u:' + E, u); }
    if (b.action === 'ban') { u.banned = !!b.on; await setJ('u:' + E, u); }
    if (b.action === 'delete') { await r('DEL', 'u:' + E); await r('SREM', 'users', E); }
    ok(res, { done: true });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
