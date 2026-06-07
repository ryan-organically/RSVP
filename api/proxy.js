// Stateless CORS proxy for Project Gutenberg plain-text downloads.
// This is the ONLY server function. It touches no database and no filesystem,
// and it only fetches from an explicit gutenberg.org allowlist.
const ALLOWED = new Set(['www.gutenberg.org', 'gutenberg.org']);
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB cap

function hostAllowed(u) {
  try { return ALLOWED.has(new URL(u).hostname); } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });
  if (!hostAllowed(url)) return res.status(403).json({ error: 'Only gutenberg.org URLs are allowed' });

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'RSVP-Reader/2.0 (local-first reader)' },
    });

    // Reject if a redirect escaped the allowlist (SSRF defense).
    if (response.url && !hostAllowed(response.url)) {
      return res.status(403).json({ error: 'Redirected off the allowlist' });
    }
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream error: ' + response.statusText });
    }
    const len = parseInt(response.headers.get('content-length') || '0', 10);
    if (len && len > MAX_BYTES) {
      return res.status(413).json({ error: 'File too large' });
    }

    const text = await response.text();
    if (text.length > MAX_BYTES) return res.status(413).json({ error: 'File too large' });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
};
