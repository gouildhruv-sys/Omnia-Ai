// Multi free-API fallback: jo key set hai wo try hoga, fail ho to agla.
const OAI = (url, model, key) => async (messages) => {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || 'api error');
  return d.choices[0].message.content;
};
const gemini = (key) => async (messages) => {
  const sys = messages.find((m) => m.role === 'system');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, ...(sys && { systemInstruction: { parts: [{ text: sys.content }] } }) }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || 'gemini error');
  return d.candidates[0].content.parts.map((p) => p.text).join('');
};
export async function ask(messages) {
  const e = process.env, list = [];
  if (e.GROQ_API_KEY) list.push(['groq', OAI('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', e.GROQ_API_KEY)]);
  if (e.GEMINI_API_KEY) list.push(['gemini', gemini(e.GEMINI_API_KEY)]);
  if (e.OPENROUTER_API_KEY) list.push(['openrouter', OAI('https://openrouter.ai/api/v1/chat/completions', 'meta-llama/llama-3.3-70b-instruct:free', e.OPENROUTER_API_KEY)]);
  if (!list.length) throw new Error('Koi API key set nahi hai (GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY)');
  let last;
  for (const [name, fn] of list) { try { return { text: await fn(messages), provider: name }; } catch (x) { last = x; } }
  throw last;
}
export const send = (res, code, obj) => res.status(code).json(obj);
