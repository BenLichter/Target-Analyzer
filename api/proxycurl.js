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

    // NinjaPear endpoints start with "v1/" — use new base URL
    // Legacy Proxycurl endpoints start with "linkedin/" or "search/" — use old base URL
    const isNinjaPear = endpoint.startsWith('v1/');
    const baseUrl = isNinjaPear
      ? 'https://nubela.co/api/'
      : 'https://nubela.co/proxycurl/api/';

    const url = new URL(baseUrl + endpoint);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      });
    }

    console.log('[NinjaPear proxy]', url.toString());

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key },
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    console.log('[NinjaPear proxy] Status:', response.status, '| Keys:', Object.keys(data).slice(0,5).join(', '));
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('[NinjaPear proxy] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
