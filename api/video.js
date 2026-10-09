import { send } from './_lib.js';
export default async function handler(req, res) {
  try {
    const { prompt = '' } = req.body || {};
    if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN set nahi hai (huggingface.co/settings/tokens)');
    const r = await fetch('https://router.huggingface.co/hf-inference/models/Lightricks/LTX-Video', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.HF_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt }),
    });
    if (!r.ok) throw new Error('Video AI busy ya limit khatam: ' + (await r.text()).slice(0, 150));
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 4.2e6) throw new Error('Video bahut badi hai, chhota prompt try karo');
    send(res, 200, { video: 'data:video/mp4;base64,' + b.toString('base64'), provider: 'huggingface-ltx' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
