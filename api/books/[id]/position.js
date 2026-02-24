const { getDB, ensureSchema } = require('../../db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    await ensureSchema();
    const db = getDB();

    if (req.method === 'GET') {
      const result = await db.execute({ sql: 'SELECT word_index FROM reading_positions WHERE book_id = ?', args: [id] });
      return res.status(200).json({ wordIndex: result.rows.length > 0 ? result.rows[0].word_index : 0 });
    }

    if (req.method === 'PUT') {
      const { wordIndex } = req.body;
      if (typeof wordIndex !== 'number') {
        return res.status(400).json({ error: 'wordIndex must be a number' });
      }
      await db.execute({
        sql: `INSERT INTO reading_positions (book_id, word_index, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT (book_id) DO UPDATE SET
                word_index = excluded.word_index,
                updated_at = datetime('now')`,
        args: [id, wordIndex]
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('position error:', err);
    return res.status(500).json({ error: err.message });
  }
};
