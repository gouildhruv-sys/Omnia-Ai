import { setJ, ok, authUser, pub, cfg } from './_lib.js';
export default async function h(req, res) {
  try {
    const u = await authUser(req), b = req.body || {}, c = await cfg();
    if (b.action === 'loc' && u.locConsent) { u.loc = { lat: +b.lat, lng: +b.lng, acc: +b.acc || 0, t: Date.now() }; await setJ('u:' + u.email, u); }
    if (b.action === 'consent') { u.locConsent = !!b.on; if (!b.on) u.loc = null; await setJ('u:' + u.email, u); }
    if (b.action === 'promo') {
      if (u.promoUsed) throw new Error('Promo code already used');
      if (String(b.code || '').trim().toLowerCase() !== c.promo.code.toLowerCase()) throw new Error('Invalid promo code');
      if (!['x1', 'x2'].includes(b.model)) throw new Error('Choose a model');
      u.subs = { ...u.subs, [b.model]: Math.max(Date.now(), u.subs?.[b.model] || 0) + c.promo.days * 864e5 }; u.promoUsed = true;
      await setJ('u:' + u.email, u);
    }
    const labels = {}; for (const k in c.models) labels[k] = c.models[k].label;
    ok(res, { user: pub(u), labels, promoDays: c.promo.days });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
