// Personal digest sync: store/list speed-readable digests in Turso (libSQL) so they
// follow you across devices via focal.wiki. Gated by a single shared SYNC_TOKEN — the
// reader and the claude-digest CLI both present it. Digests are namespaced by a hash
// of the token, so a different token is a different private space. No accounts.
//
// Routes (same file, by method):
//   GET    /api/digests        -> [{id,title,project,time,blocks[]}, ...] newest first (<=100)
//   POST   /api/digests        -> body {id,title,project,time,blocks[]} ; upsert
//   DELETE /api/digests?id=ID  -> remove one
//
// Storage is Turso over its HTTP pipeline API — zero npm deps, same spirit as proxy.js.
const crypto = require('crypto');
const { turso, configured } = require('../lib/turso.js');

const SYNC_TOKEN = (process.env.SYNC_TOKEN || '').trim();

let _ready = null; // ensure-schema promise, once per cold start

function ensureSchema() {
  return turso(`CREATE TABLE IF NOT EXISTS digests(
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT, project TEXT,
      time TEXT, blocks TEXT, created INTEGER)`)
    .then(() => turso(`CREATE INDEX IF NOT EXISTS idx_digests_owner ON digests(owner, created DESC)`));
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
const str = v => (v == null ? '' : String(v));

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

  try {
    _ready = _ready || ensureSchema();
    await _ready;

    if (req.method === 'GET') {
      const rows = await turso(
        `SELECT id,title,project,time,blocks FROM digests WHERE owner=? ORDER BY created DESC LIMIT 100`,
        [owner]);
      return res.status(200).json(rows.map(r => ({
        id: r.id, title: r.title, project: r.project, time: r.time,
        blocks: safeBlocks(r.blocks),
      })));
    }

    if (req.method === 'POST') {
      const d = await readJson(req);
      if (!d || !d.id || !Array.isArray(d.blocks)) return res.status(400).json({ error: 'invalid digest' });
      await turso(
        `INSERT OR REPLACE INTO digests(id,owner,title,project,time,blocks,created) VALUES(?,?,?,?,?,?,?)`,
        [str(d.id), owner, str(d.title), str(d.project), str(d.time || new Date().toISOString()),
         JSON.stringify(d.blocks).slice(0, 500000), Date.now()]);
      return res.status(200).json({ ok: true, id: d.id });
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'missing id' });
      await turso(`DELETE FROM digests WHERE owner=? AND id=?`, [owner, str(id)]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage error', detail: String(e.message || e).slice(0, 200) });
  }
};

function safeBlocks(s) {
  try { const b = JSON.parse(s); return Array.isArray(b) ? b : []; } catch { return []; }
}
