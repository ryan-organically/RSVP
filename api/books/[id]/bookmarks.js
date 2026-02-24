const { getDB, ensureSchema } = require('../../db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    await ensureSchema();
    const db = getDB();

    if (req.method === 'GET') {
      const result = await db.execute({
        sql: `SELECT id, word_index as idx, label, created_at as time
              FROM bookmarks WHERE book_id = ?
              ORDER BY word_index ASC`,
        args: [id]
      });
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { idx, label } = req.body;
      if (typeof idx !== 'number' || !label) {
        return res.status(400).json({ error: 'Missing idx or label' });
      }
      await db.execute({
        sql: `INSERT INTO bookmarks (book_id, word_index, label)
              VALUES (?, ?, ?)
              ON CONFLICT (book_id, word_index) DO NOTHING`,
        args: [id, idx, label]
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { idx } = req.body || {};
      if (typeof idx === 'number') {
        await db.execute({
          sql: 'DELETE FROM bookmarks WHERE book_id = ? AND word_index = ?',
          args: [id, idx]
        });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('bookmarks error:', err);
    return res.status(500).json({ error: err.message });
  }
};
