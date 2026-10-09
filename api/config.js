// Public settings the website needs. None of these are secret.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    discordUrl: process.env.DISCORD_URL || "",
    allowGuest: process.env.ALLOW_GUEST !== "0",
    requireLogin: !!process.env.GOOGLE_CLIENT_ID && process.env.REQUIRE_LOGIN !== "0",
    imageAI: !!((process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) || process.env.POLLINATIONS_KEY),
  });
};
