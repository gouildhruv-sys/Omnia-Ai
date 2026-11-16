import { ok, authUser, chatCall } from './_lib.js';
export default async function h(req, res) {
  try {
    const u = await authUser(req), { model = 'lite', prompt = '' } = req.body || {};
    const sys = { role: 'system', content: 'You are an expert front-end engineer. Return ONE complete self-contained HTML file (inline CSS and JS, mobile-first, premium modern design with animations). Output only the code, no explanation.' };
    const t = await chatCall(model, [sys, { role: 'user', content: prompt }], u);
    ok(res, { html: t.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '') });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
