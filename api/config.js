// Public settings the website needs. None of these are secret.
const store = require("./_store.js");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const e = process.env;
  res.status(200).json({
    googleClientId: e.GOOGLE_CLIENT_ID || "",
    discordUrl: e.DISCORD_URL || "",
    allowGuest: e.ALLOW_GUEST !== "0",
    requireLogin: (!!e.GOOGLE_CLIENT_ID || store.accountsOn()) && e.REQUIRE_LOGIN !== "0",
    accounts: store.accountsOn(),
    imageAI: !!((e.CF_ACCOUNT_ID && e.CF_API_TOKEN) || e.POLLINATIONS_KEY),
    videoAI: !!e.FAL_KEY,
    announcement: await store.announcement(),
  });
};
