export default async function handler(req, res) {
  const { name } = req.query;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}`,
    { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } }
  );
  const data = await r.json();
  const uri =
    data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  res.json({ done: !!data.done, uri, error: data.error });
}
