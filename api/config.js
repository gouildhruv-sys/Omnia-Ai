module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    discordUrl: process.env.DISCORD_URL || "",
    requireLogin: !!process.env.GOOGLE_CLIENT_ID && process.env.REQUIRE_LOGIN !== "0",
  });
};
