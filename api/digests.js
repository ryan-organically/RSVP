const { getDB, ensureSchema } = require('./db');

const MAX_DIGESTS = 50;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  await ensureSchema();

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleGet(req, res) {
  try {
    const db = getDB();
    const result = await db.execute(
      `SELECT id, title, project, time, blocks FROM digests ORDER BY created_at DESC LIMIT ${MAX_DIGESTS}`
    );
    const digests = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      project: row.project,
      time: row.time,
      blocks: JSON.parse(row.blocks),
    }));
    return res.status(200).json(digests);
  } catch (err) {
    console.error('Digest read error:', err.message);
    return res.status(500).json({ error: 'Failed to load digests' });
  }
}

async function handlePost(req, res) {
  const digest = req.body;

  if (!digest || typeof digest !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  if (!digest.id || typeof digest.id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "id" (string required)' });
  }
  if (!digest.title || typeof digest.title !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "title" (string required)' });
  }
  if (!Array.isArray(digest.blocks)) {
    return res.status(400).json({ error: 'Missing or invalid "blocks" (array required)' });
  }

  try {
    const db = getDB();
    await db.execute({
      sql: `INSERT OR REPLACE INTO digests (id, title, project, time, blocks) VALUES (?, ?, ?, ?, ?)`,
      args: [
        digest.id,
        digest.title,
        digest.project || '',
        digest.time || new Date().toISOString(),
        JSON.stringify(digest.blocks),
      ],
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Digest write error:', err.message);
    return res.status(500).json({ error: 'Failed to save digest' });
  }
}
