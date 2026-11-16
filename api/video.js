import { ok, authUser, cfg } from './_lib.js';
export default async function h(req, res) {
  try {
    await authUser(req); const { prompt = '' } = req.body || {}, c = (await cfg()).video;
    if (!c.key) throw new Error('Video API key is not set in the admin panel');
    const x = await fetch(c.base, { method: 'POST', headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: prompt }) });
    if (!x.ok) throw new Error('Video AI busy/limit: ' + (await x.text()).slice(0, 120));
    const b = Buffer.from(await x.arrayBuffer()); if (b.length > 4.2e6) throw new Error('Video is too large, try a shorter prompt');
    ok(res, { video: 'data:video/mp4;base64,' + b.toString('base64') });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
