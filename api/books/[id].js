const { getDB, ensureSchema } = require('../db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    await ensureSchema();
    const db = getDB();

    if (req.method === 'GET') {
      const result = await db.execute({ sql: 'SELECT id, title, word_count, source, added_at FROM books WHERE id = ?', args: [id] });
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      // Delete related data first (SQLite foreign key cascade may not be on)
      await db.execute({ sql: 'DELETE FROM bookmarks WHERE book_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM reading_positions WHERE book_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM books WHERE id = ?', args: [id] });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('books/[id] error:', err);
    return res.status(500).json({ error: err.message });
  }
};
