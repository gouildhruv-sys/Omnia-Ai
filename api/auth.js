import { r, getJ, setJ, ok, hash, rid, pub, cfg } from './_lib.js';
export default async function h(req, res) {
  try {
    const b = req.body || {}, email = String(b.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email');
    if (String(b.password || '').length < 6) throw new Error('Password must be at least 6 characters');
    let u = await getJ('u:' + email);
    if (b.action === 'register') {
      if (u) throw new Error('This email is already registered. Please sign in.');
      if (!b.first?.trim() || !b.last?.trim()) throw new Error('Enter first and last name');
      const salt = rid().slice(0, 16);
      u = { first: b.first.trim(), last: b.last.trim(), email, salt, pass: hash(b.password, salt), subs: {}, locConsent: !!b.locConsent, created: Date.now() };
      if (b.promo?.trim()) {
        const c = await cfg();
        if (b.promo.trim().toLowerCase() !== c.promo.code.toLowerCase()) throw new Error('Invalid promo code');
        if (!['x1', 'x2'].includes(b.promoModel)) throw new Error('Choose a model for the promo');
        u.subs[b.promoModel] = Date.now() + c.promo.days * 864e5; u.promoUsed = true;
      }
      await setJ('u:' + email, u); await r('SADD', 'users', email);
    } else {
      if (!u || u.pass !== hash(b.password, u.salt)) throw new Error('Wrong email or password');
      if (u.banned) throw new Error('Your account is suspended');
    }
    const token = rid(); await r('SET', 't:' + token, email, 'EX', 60 * 60 * 24 * 90);
    ok(res, { token, user: pub(u) });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
