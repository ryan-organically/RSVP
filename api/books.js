const { getDB, ensureSchema } = require('./db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();
    const db = getDB();

    if (req.method === 'GET') {
      const result = await db.execute(`
        SELECT b.id, b.title, b.word_count, b.source, b.added_at,
               COALESCE(rp.word_index, 0) as word_index
        FROM books b
        LEFT JOIN reading_positions rp ON rp.book_id = b.id
        ORDER BY b.added_at DESC
      `);
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { id, title, wordCount, source, content } = req.body;
      if (!id || !title || !content) {
        return res.status(400).json({ error: 'Missing id, title, or content' });
      }
      await db.execute({
        sql: `INSERT INTO books (id, title, word_count, source, content)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                title = excluded.title,
                word_count = excluded.word_count,
                content = excluded.content`,
        args: [id, title, wordCount || 0, source || 'import', content]
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('books error:', err);
    return res.status(500).json({ error: err.message });
  }
};
