export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { endpoint, params, key } = req.body;
    if (!key) return res.status(400).json({ error: 'No key' });

    const url = new URL('https://nubela.co/proxycurl/api/' + endpoint);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      });
    }

    console.log('[Proxycurl proxy]', url.pathname + url.search);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key },
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    console.log('[Proxycurl proxy] Status:', response.status);
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
