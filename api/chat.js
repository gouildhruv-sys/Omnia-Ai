import { ask, send } from './_lib.js';
export default async function handler(req, res) {
  try {
    const { messages = [] } = req.body || {};
    const sys = { role: 'system', content: 'You are Omnia, a friendly assistant. Reply in the same language as the user (Hinglish is fine).' };
    send(res, 200, await ask([sys, ...messages.slice(-20)]));
  } catch (e) { send(res, 500, { error: e.message }); }
}
