export default async function handler(req, res) {
  const { video_id } = req.query;
  const r = await fetch(
    `https://apihub.agnes-ai.com/agnesapi?video_id=${video_id}&model_name=agnes-video-2.5`,
    { headers: { Authorization: `Bearer ${process.env.AGNES_API_KEY}` } }
  );
  res.status(r.status).json(await r.json());
}
