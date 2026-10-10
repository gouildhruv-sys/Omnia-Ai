// What plan is this person on, how many invites, and any active cooldown timers.
const S = require("./_store.js");
const P = require("./_plan.js");
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const who = await S.whoFromHeader(req.headers.authorization);
  const id = who ? who.email : S.guestId(req);
  const cfg = await P.getCfg();
  const out = { plan: who ? "free" : "guest", until: 0, cooldowns: await P.cooldowns(id), pay: cfg.premium.payUrl ? { url: cfg.premium.payUrl, price: cfg.premium.price, note: cfg.premium.note } : null, maintenance: cfg.maintenance };
  if (who && S.dbOn()) {
    try {
      const until = await P.premiumUntil(who.email);
      if (until > Date.now()) { out.plan = "premium"; out.until = until; }
      const code = await P.refCodeFor(who.email);
      const r = await S.pipe([["HGET", "omnia:refn", who.email], ["HGET", "omnia:refd", who.email]], 2500);
      out.invite = { code, count: Number(r[0]) || 0, earnedDays: Number(r[1]) || 0, need: cfg.premium.inviteNeed, days: cfg.premium.inviteDays, capDays: cfg.premium.inviteCapDays };
    } catch (e) {}
  }
  res.status(200).json(out);
};
