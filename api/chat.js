import { ok, authUser, chatCall } from './_lib.js';
export default async function h(req, res) {
  try {
    const u = await authUser(req), { model = 'lite', messages = [] } = req.body || {};
    const sys = { role: 'system', content: 'You are Omnyx, the AI of the Omnia Now app. Be smart, warm and concise. Reply in the same language as the user (Hinglish is fine).' };
    ok(res, { text: await chatCall(model, [sys, ...messages.slice(-24)], u) });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
