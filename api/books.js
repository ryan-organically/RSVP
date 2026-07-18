// Personal book-library sync: store the reader's library so downloaded books follow
// you across devices via focal.wiki. Same shared SYNC_TOKEN as /api/digests.
//
// Metadata is always stored. Full text is stored ONLY for imported/pasted books
// (source !== 'gutenberg'/'welcome'), since Gutenberg books self-heal by re-fetching
// from their gutenId and the welcome book ships with the app. Text is capped to stay
// under Vercel's request-body limit; bigger books sync metadata only.
//
// Routes (by method):
//   GET    /api/books          -> [{id, meta{}, has_text}], no text (light list)
//   GET    /api/books?id=ID    -> {id, meta{}, text} for one book (self-heal)
//   POST   /api/books          -> body {id, meta{}, text?} ; upsert
//   DELETE /api/books?id=ID    -> remove one
const crypto = require('crypto');
const { turso, configured } = require('../lib/turso.js');

const SYNC_TOKEN = (process.env.SYNC_TOKEN || '').trim();
const MAX_TEXT = 3_500_000; // ~3.5 MB, comfortably under Vercel's 4.5 MB body limit

let _ready = null;
function ensureSchema() {
  return turso(`CREATE TABLE IF NOT EXISTS books(
      id TEXT NOT NULL, owner TEXT NOT NULL, meta TEXT, text TEXT,
      has_text INTEGER DEFAULT 0, updated INTEGER, PRIMARY KEY(owner, id))`)
    .then(() => turso(`CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner, updated DESC)`));
}

function eqToken(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return data ? JSON.parse(data) : {}; } catch { return null; }
}
const safe = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; } };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!configured()) return res.status(503).json({ error: 'storage not configured' });
  if (!SYNC_TOKEN) return res.status(503).json({ error: 'sync disabled (set SYNC_TOKEN)' });

  const presented = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!presented || !eqToken(presented, SYNC_TOKEN)) return res.status(401).json({ error: 'unauthorized' });
  const owner = crypto.createHash('sha256').update(presented).digest('hex').slice(0, 16);
  const id = (req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id');

  try {
    _ready = _ready || ensureSchema();
    await _ready;

    if (req.method === 'GET') {
      if (id) {
        const rows = await turso(`SELECT id,meta,text FROM books WHERE owner=? AND id=?`, [owner, String(id)]);
        if (!rows.length) return res.status(404).json({ error: 'not found' });
        return res.status(200).json({ id: rows[0].id, meta: safe(rows[0].meta, {}), text: rows[0].text || '' });
      }
      const rows = await turso(
        `SELECT id,meta,has_text FROM books WHERE owner=? ORDER BY updated DESC LIMIT 500`, [owner]);
      return res.status(200).json(rows.map(r => ({ id: r.id, meta: safe(r.meta, {}), has_text: !!r.has_text })));
    }

    if (req.method === 'POST') {
      const b = await readJson(req);
      if (!b || !b.id || !b.meta) return res.status(400).json({ error: 'invalid book' });
      let text = typeof b.text === 'string' ? b.text : '';
      let stored = !!text;
      if (text.length > MAX_TEXT) { text = ''; stored = false; } // too big → metadata only
      await turso(
        `INSERT OR REPLACE INTO books(id,owner,meta,text,has_text,updated) VALUES(?,?,?,?,?,?)`,
        [String(b.id), owner, JSON.stringify(b.meta), text || null, stored ? 1 : 0, Date.now()]);
      return res.status(200).json({ ok: true, id: b.id, text_stored: stored });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'missing id' });
      await turso(`DELETE FROM books WHERE owner=? AND id=?`, [owner, String(id)]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage error', detail: String(e.message || e).slice(0, 200) });
  }
};
