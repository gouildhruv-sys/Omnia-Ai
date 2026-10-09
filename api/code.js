import { ask, send } from './_lib.js';
export default async function handler(req, res) {
  try {
    const { prompt = '' } = req.body || {};
    const sys = { role: 'system', content: 'Return ONE complete self-contained HTML file (inline CSS and JS, mobile friendly, modern design). Output only the code, no explanation.' };
    const r = await ask([sys, { role: 'user', content: prompt }]);
    const html = r.text.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '');
    send(res, 200, { html, provider: r.provider });
  } catch (e) { send(res, 500, { error: e.message }); }
}
