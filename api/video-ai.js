export default async function handler(req, res) {
  const { prompt, seconds = "5", size = "720P", aspect_ratio = "16:9" } = req.body;
  const r = await fetch("https://apihub.agnes-ai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AGNES_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "agnes-video-2.5",
      prompt, seconds, mode: "text", size, aspect_ratio,
    }),
  });
  res.status(r.status).json(await r.json());
}
