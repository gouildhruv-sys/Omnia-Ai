// Public settings the website needs. None of these are secret.
const store = require("./_store.js");
const P = require("./_plan.js");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const e = process.env, cfg = await P.getCfg();
  res.status(200).json({
    googleClientId: e.GOOGLE_CLIENT_ID || "",
    discordUrl: e.DISCORD_URL || "",
    allowGuest: e.ALLOW_GUEST !== "0",
    requireLogin: (!!e.GOOGLE_CLIENT_ID || store.accountsOn()) && e.REQUIRE_LOGIN !== "0",
    accounts: store.accountsOn(),
    imageAI: !!((e.CF_ACCOUNT_ID && e.CF_API_TOKEN) || e.POLLINATIONS_KEY),
    videoAI: false,
    announcement: await store.announcement(),
    ads: await store.activeAds(),
    retentionDays: Math.max(1, Number(e.CHAT_RETENTION_DAYS || 30)),
    chatLog: e.CHAT_LOG !== "0",
    plan: P.publicCfg(cfg),
  });
};
