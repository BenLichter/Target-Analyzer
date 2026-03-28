export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid sync ID' });
  }

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) {
    return res.status(503).json({ error: 'KV storage not configured' });
  }

  const key = `cp:${id}`;
  const kvHeaders = {
    Authorization: `Bearer ${KV_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // GET — load pipeline data
  if (req.method === 'GET') {
    const r = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: kvHeaders,
      body: JSON.stringify([['GET', key]]),
    });
    const data = await r.json();
    const raw = data[0]?.result;
    if (!raw) return res.json({ pipeline: [], alerts: [] });
    try { return res.json(JSON.parse(raw)); }
    catch { return res.json({ pipeline: [], alerts: [] }); }
  }

  // POST — save pipeline data
  if (req.method === 'POST') {
    const payload = JSON.stringify(req.body);
    if (payload.length > 10_000_000) return res.status(413).json({ error: 'Payload too large' });
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: kvHeaders,
      body: JSON.stringify([['SET', key, payload, 'EX', '7776000']]), // 90-day TTL
    });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
