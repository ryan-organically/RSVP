// Stateless CORS proxy for Project Gutenberg plain-text downloads.
// This is the ONLY server function. It touches no database and no filesystem,
// and it only fetches from an explicit gutenberg.org allowlist.
// Gutenberg is slow/flaky from datacenter IPs, so: generous timeout, one retry,
// and edge caching so any given book is only slow the first time.
const ALLOWED = new Set(['www.gutenberg.org', 'gutenberg.org']);
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB cap
const UPSTREAM_TIMEOUT = 25000;     // ms, kept under the function maxDuration in vercel.json
const UA = 'Mozilla/5.0 (compatible; RSVP-Reader/2.0; +https://github.com/ryan-organically/RSVP)';

function hostAllowed(u) {
  try { return ALLOWED.has(new URL(u).hostname); } catch { return false; }
}
async function fetchUpstream(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/plain, */*' },
    });
  } finally { clearTimeout(t); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });
  if (!hostAllowed(url)) return res.status(403).json({ error: 'Only gutenberg.org URLs are allowed' });

  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchUpstream(url);
      if (response.url && !hostAllowed(response.url)) return res.status(403).json({ error: 'Redirected off the allowlist' });
      if (!response.ok) {
        lastErr = 'upstream ' + response.status;
        if (response.status >= 500 || response.status === 429) continue; // transient, retry
        return res.status(response.status).json({ error: 'Upstream error: ' + response.statusText });
      }
      const len = parseInt(response.headers.get('content-length') || '0', 10);
      if (len && len > MAX_BYTES) return res.status(413).json({ error: 'File too large' });
      const text = await response.text();
      if (text.length > MAX_BYTES) return res.status(413).json({ error: 'File too large' });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      // cache at the browser AND the Vercel edge, so the next reader gets it instantly
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
      return res.status(200).send(text);
    } catch (err) {
      lastErr = err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || 'fetch failed';
      if (attempt < 2) await new Promise(r => setTimeout(r, 500)); // brief backoff, then retry
    }
  }
  return res.status(504).json({ error: 'Project Gutenberg is slow or rate-limiting right now (' + lastErr + '). Please try again in a moment.' });
};
