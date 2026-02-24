module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Only allow Gutenberg domains
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const allowed = ['www.gutenberg.org', 'gutenberg.org'];
  if (!allowed.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'Only gutenberg.org URLs are allowed' });
  }

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'RSVP-Reader/1.0' },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream error: ' + response.statusText });
    }

    const text = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
};
