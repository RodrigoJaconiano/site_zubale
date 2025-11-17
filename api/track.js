import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const page = req.query.page;

  if (!page) {
    return res.status(400).json({ error: "Missing page parameter" });
  }

  const count = await kv.incr(`visits:${page}`);

  res.status(200).json({ page, visits: count });
}


