// Stateless public read endpoint. Fetches a PUBLIC document, extracts readable text,
// returns it. Stores nothing, authenticates nothing, and reads no user data.
//
//   GET /api/read?url=<https url>[&format=json|text]
//
// This is the shared substrate under the arXiv / Wikipedia / Gutenberg reader routes,
// the browser extension, embed.js, and the MCP server's focal_read_url tool. Keeping it
// stateless is the whole design: the caller's text never touches our storage, so none of
// those surfaces can become an un-namespaced data path (see CLAUDE.md security contract).
//
// Everything outbound goes through lib/fetch-safe.js — https only, host allowlist,
// public-IP checks, manually re-validated redirects, streamed byte cap.
const { safeFetch, readCapped, BlockedError } = require('../lib/fetch-safe.js');
const { extract, tagsToText, decodeEntities, countWords } = require('../lib/extract.js');
const { record } = require('../lib/metrics.js');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 3 * 1024 * 1024;
const TIMEOUT_MS = 20000;

// Hosts we serve. Adding one is a deliberate act: it widens the SSRF blast radius from
// "nothing" to "that host", and it makes us responsible for that source's terms.
const ALLOWED_HOSTS = new Set([
  'gutenberg.org', 'www.gutenberg.org',
  'arxiv.org', 'www.arxiv.org', 'export.arxiv.org',
  'biorxiv.org', 'www.biorxiv.org',
  'medrxiv.org', 'www.medrxiv.org',
  'pmc.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov',
  'standardebooks.org', 'www.standardebooks.org',
]);
// Language codes are not all two letters: "simple", "zh-yue", "be-tarask" are all real.
// The trailing ".wikipedia.org" must be a literal label boundary so "evilwikipedia.org"
// and "wikipedia.org.attacker.com" cannot match.
const WIKIPEDIA_HOST = /^[a-z]{2,12}(-[a-z]{2,10})?\.(m\.)?wikipedia\.org$/i;

function hostAllowed(hostname) {
  const h = String(hostname).toLowerCase();
  return ALLOWED_HOSTS.has(h) || WIKIPEDIA_HOST.test(h);
}

function classify(url) {
  const h = url.hostname.toLowerCase();
  if (WIKIPEDIA_HOST.test(h)) return 'wikipedia';
  if (h.endsWith('arxiv.org')) return 'arxiv';
  if (h.endsWith('gutenberg.org')) return 'gutenberg';
  if (h.endsWith('biorxiv.org')) return 'biorxiv';
  if (h.endsWith('medrxiv.org')) return 'medrxiv';
  if (h.endsWith('ncbi.nlm.nih.gov')) return 'pubmed';
  if (h.endsWith('standardebooks.org')) return 'standardebooks';
  return 'web';
}

async function fetchText(url, accept) {
  const { res, finalUrl } = await safeFetch(url, {
    allow: hostAllowed, timeoutMs: TIMEOUT_MS, accept,
  });
  if (!res.ok) throw new BlockedError('upstream returned ' + res.status, res.status === 404 ? 404 : 502);
  return { body: await readCapped(res, MAX_BYTES), finalUrl };
}

// --- arXiv -----------------------------------------------------------------
// Prefer arXiv's own HTML rendering (full text). Fall back to the Atom API, which
// always has title/authors/abstract even when no HTML rendering exists.
// Handles both id schemes: modern "2405.01234" and pre-2007 "math/0309285",
// with or without a version suffix, from /abs/, /pdf/ or /html/ paths.
function arxivId(url) {
  const m = url.pathname.match(
    /\/(?:abs|pdf|html)\/((?:[a-z-]+(?:\.[A-Za-z]{2})?\/)?[^/?#]+?)(?:v\d+)?(?:\.pdf)?$/i);
  return m ? m[1] : null;
}

async function readArxiv(url) {
  const id = arxivId(url);
  if (!id) throw new BlockedError('not an arXiv abs/pdf/html URL', 400);

  try {
    const { body } = await fetchText(`https://arxiv.org/html/${encodeURIComponent(id)}`, 'text/html');
    const got = extract(body);
    if (got.words > 500) {
      return { ...got, title: got.title.replace(/\s*-\s*arXiv.*$/i, ''), canonical: `https://arxiv.org/abs/${id}` };
    }
  } catch { /* no HTML rendering for this paper — fall through to the API */ }

  const { body } = await fetchText(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
    'application/atom+xml');
  const entry = body.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entry) throw new BlockedError('arXiv has no record for ' + id, 404);
  const field = re => { const m = entry[1].match(re); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''; };
  const title = field(/<title>([\s\S]*?)<\/title>/i);
  const summary = field(/<summary>([\s\S]*?)<\/summary>/i);
  const authors = [...entry[1].matchAll(/<name>([\s\S]*?)<\/name>/gi)]
    .map(m => decodeEntities(m[1]).trim()).filter(Boolean);
  const published = field(/<published>([\s\S]*?)<\/published>/i).slice(0, 10);
  const text = [title, authors.join(', '), published, '', 'Abstract', '', summary,
    '', '(Full text is not available as HTML for this paper. Read the PDF in Focal by ' +
    'downloading it and dropping it into the library.)'].join('\n');
  return { title, byline: authors.join(', '), text, words: countWords(text), canonical: `https://arxiv.org/abs/${id}` };
}

// --- Wikipedia -------------------------------------------------------------
async function readWikipedia(url) {
  const m = url.pathname.match(/\/wiki\/(.+)$/);
  const title = m ? decodeURIComponent(m[1]) : (url.searchParams.get('title') || '');
  if (!title) throw new BlockedError('not a Wikipedia article URL', 400);
  const host = url.hostname.replace(/^m\./, '');
  const api = `https://${host}/w/api.php?action=query&format=json&formatversion=2` +
    `&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`;
  const { body } = await fetchText(api, 'application/json');
  let data;
  try { data = JSON.parse(body); } catch { throw new BlockedError('Wikipedia returned malformed JSON', 502); }
  const page = data && data.query && data.query.pages && data.query.pages[0];
  if (!page || page.missing) throw new BlockedError('no such Wikipedia article', 404);
  const text = String(page.extract || '').trim();
  if (!text) throw new BlockedError('article has no extractable text', 404);
  return {
    title: page.title, byline: '', text, words: countWords(text),
    canonical: `https://${host}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
  };
}

// --- Gutenberg / Standard Ebooks / plain text ------------------------------
async function readPlainOrHtml(url) {
  const wantsPlain = /\.txt(\.utf-?8)?$/i.test(url.pathname);
  const { body, finalUrl } = await fetchText(url.href, wantsPlain ? 'text/plain' : 'text/html');
  if (wantsPlain) {
    const text = body.replace(/\r\n?/g, '\n').trim();
    const t = text.match(/^Title:\s*(.+)$/mi);
    const a = text.match(/^Author:\s*(.+)$/mi);
    return { title: t ? t[1].trim() : '', byline: a ? a[1].trim() : '', text, words: countWords(text), canonical: finalUrl };
  }
  return { ...extract(body), canonical: finalUrl };
}

const READERS = {
  arxiv: readArxiv,
  wikipedia: readWikipedia,
  gutenberg: readPlainOrHtml,
  standardebooks: readPlainOrHtml,
  biorxiv: readPlainOrHtml,
  medrxiv: readPlainOrHtml,
  pubmed: readPlainOrHtml,
  web: readPlainOrHtml,
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const q = req.query || {};
  const raw = q.url || (() => { try { return new URL(req.url, 'http://x').searchParams.get('url'); } catch { return null; } })();
  if (!raw) return res.status(400).json({ error: 'missing url parameter' });

  let url;
  try { url = new URL(raw); } catch { return res.status(400).json({ error: 'malformed url' }); }
  if (!hostAllowed(url.hostname)) {
    return res.status(403).json({
      error: 'host is not on the allowlist',
      allowed: [...ALLOWED_HOSTS].concat(['*.wikipedia.org']).sort(),
    });
  }

  const source = classify(url);
  try {
    const got = await READERS[source](url);
    let text = String(got.text || '');
    let truncated = false;
    if (text.length > MAX_TEXT_CHARS) { text = text.slice(0, MAX_TEXT_CHARS); truncated = true; }
    if (!text.trim()) return res.status(422).json({ error: 'no readable text found at that URL', source });

    // Public documents: cache hard at the browser and the edge.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400');

    // Aggregate count only: which sources get read, by day. No caller, no document,
    // no identity — the URL is never stored, only the source label. Never fatal.
    await record('read', source);

    if ((q.format || 'json') === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(text);
    }
    return res.status(200).json({
      source,
      url: got.canonical || url.href,
      title: got.title || '',
      byline: got.byline || '',
      words: countWords(text),
      chars: text.length,
      truncated,
      text,
    });
  } catch (err) {
    const status = err instanceof BlockedError ? err.status : 502;
    return res.status(status).json({
      error: String(err && err.message || 'fetch failed').slice(0, 200),
      source,
    });
  }
};

module.exports.hostAllowed = hostAllowed;
module.exports.classify = classify;
module.exports.arxivId = arxivId;
