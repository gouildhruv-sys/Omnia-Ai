import { ok, authUser, cfg } from './_lib.js';
export default async function h(req, res) {
  try {
    await authUser(req); const { prompt = '' } = req.body || {}, c = (await cfg()).image;
    if (c.type === 'hf') {
      const x = await fetch(c.base || `https://router.huggingface.co/hf-inference/models/${c.model}`, { method: 'POST', headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: prompt }) });
      if (!x.ok) throw new Error('Image AI error: ' + (await x.text()).slice(0, 120));
      return ok(res, { image: 'data:image/jpeg;base64,' + Buffer.from(await x.arrayBuffer()).toString('base64') });
    }
    if (c.type === 'openai') {
      const x = await fetch(c.base.replace(/\/$/, '') + '/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.model, prompt, response_format: 'b64_json' }) });
      const d = await x.json(); if (!x.ok) throw new Error(d?.error?.message || 'Image AI error');
      return ok(res, { image: 'data:image/png;base64,' + d.data[0].b64_json });
    }
    ok(res, { image: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}` });
  } catch (e) { ok(res, { error: e.message }, 400); }
}
