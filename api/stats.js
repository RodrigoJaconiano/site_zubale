import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const keys = await kv.keys('visits:*');
  const data = {};

  for (const key of keys) {
    const page = key.replace('visits:', '');
    data[page] = await kv.get(key);
  }

  res.status(200).json(data);
}
