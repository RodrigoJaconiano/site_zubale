import { createClient } from "redis";

export default async function handler(req, res) {
  const client = createClient({
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD
  });

  await client.connect();

  // pega o nome da página
  const pagina = req.query.pagina || "index";

  // incrementa o contador
  await client.incr(`visitas:${pagina}`);

  await client.quit();

  res.status(200).json({ ok: true });
}
