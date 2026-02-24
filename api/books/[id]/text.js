const { getDB, ensureSchema } = require('../../db');
const zlib = require('zlib');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id) return res.status(400).send('Missing id');

  try {
    await ensureSchema();
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT content FROM books WHERE id = ?', args: [id] });
    if (result.rows.length === 0) return res.status(404).send('Not found');

    const content = result.rows[0].content;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (acceptEncoding.includes('gzip') && content.length > 1024) {
      res.setHeader('Content-Encoding', 'gzip');
      const compressed = zlib.gzipSync(content);
      return res.status(200).send(compressed);
    }

    return res.status(200).send(content);
  } catch (err) {
    console.error('books/[id]/text error:', err);
    return res.status(500).send(err.message);
  }
};
