import { send } from './_lib.js';
export default async function handler(req, res) {
  const { prompt = '' } = req.body || {};
  try {
    if (process.env.HF_TOKEN) {
      try {
        const r = await fetch('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
          method: 'POST', headers: { Authorization: 'Bearer ' + process.env.HF_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: prompt }),
        });
        if (r.ok) {
          const b = Buffer.from(await r.arrayBuffer()).toString('base64');
          return send(res, 200, { image: 'data:image/jpeg;base64,' + b, provider: 'huggingface-flux' });
        }
      } catch (_) {}
    }
    // Free, no key
    const seed = Math.floor(Math.random() * 1e6);
    send(res, 200, { image: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`, provider: 'pollinations' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
