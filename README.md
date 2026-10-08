# Omnia AI website v3 (free setup)

Files: index.html (website), api/ai.js (AI server), api/config.js (public settings), vercel.json.

## Update your existing site
GitHub > open your repository > for each file: Add file > Upload files (same names replace the old ones).
For the `api` folder on a phone: open `api/ai.js` > pencil icon > select all > paste the new code > Commit.
Create `api/config.js` with "Add file > Create new file" and the name `api/config.js`.

## Environment variables (Vercel > Settings > Environment Variables, then Redeploy)
- GEMINI_API_KEY   your free key from aistudio.google.com (name goes in Key, the key goes in Value)
- DISCORD_URL      your Discord invite link, for example https://discord.gg/xxxxxxx
- GOOGLE_CLIENT_ID for Google sign in (steps below)
- DAILY_LIMIT      optional, requests per user per day (default 60)

## Google sign in (free)
1. Open console.cloud.google.com and create a project (any name).
2. Go to APIs & Services > OAuth consent screen (also called Google Auth Platform). Choose External, fill app name and your email, save. Publish the app (set status to In production) so everyone can sign in, not only test users.
3. Credentials > Create credentials > OAuth client ID > Application type: Web application.
4. Authorized JavaScript origins: add your site address exactly, for example https://omnia-ai.vercel.app (and your custom domain later). No slash at the end.
5. Create, copy the Client ID (looks like 123456-abc.apps.googleusercontent.com).
6. In Vercel add GOOGLE_CLIENT_ID = that Client ID, then Redeploy.
7. Open the site: "Sign in" appears. With login on, only signed-in users can use the AI.
Set REQUIRE_LOGIN=0 if you want to allow use without signing in.

## Good to know
- Free tier limits apply (requests per minute and day). Google can change them.
- Free-tier requests may be used by Google to improve its products. Do not type private data.
- Vercel Hobby is for personal, non-commercial use.
- Per-user limits are kept in memory and can reset when the server restarts.
- Image and video quality: video uses Omnia's own animation engine (AI writes the plan), images are AI vector art.
