import { createClient } from "redis";

export default async function handler(req, res) {
  const client = createClient({
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD
  });

  await client.connect();

  const paginas = ["index", "k", "acc"];
  const result = {};

  for (const p of paginas) {
    result[p] = Number(await client.get(`visitas:${p}`)) || 0;
  }

  await client.quit();

  res.status(200).json(result);
}
