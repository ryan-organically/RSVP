// Read the aggregate counters. GET only, SYNC_TOKEN required.
//
// There is deliberately no write route. Counters are incremented server-side by the
// functions that serve the requests (see lib/metrics.js); nothing a caller sends can
// create or inflate a number, which is both a privacy property and an integrity one.
//
//   GET /api/metrics?days=30  ->  { days, totals: {...}, byDay: [...], rows: [...] }
const crypto = require('crypto');
const { read } = require('../lib/metrics.js');

const SYNC_TOKEN = (process.env.SYNC_TOKEN || '').trim();

function eqToken(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!SYNC_TOKEN) return res.status(503).json({ error: 'metrics disabled (set SYNC_TOKEN)' });

  const presented = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!presented || !eqToken(presented, SYNC_TOKEN)) return res.status(401).json({ error: 'unauthorized' });

  const days = parseInt((req.query && req.query.days) || '30', 10) || 30;
  try {
    const rows = await read(days);
    const totals = {}, byDay = {};
    for (const r of rows) {
      const key = r.dim ? `${r.event}:${r.dim}` : r.event;
      totals[key] = (totals[key] || 0) + r.n;
      byDay[r.day] = (byDay[r.day] || 0) + r.n;
    }
    return res.status(200).json({
      days,
      totals,
      byDay: Object.entries(byDay).map(([day, n]) => ({ day, n })).sort((a, b) => a.day < b.day ? 1 : -1),
      rows,
    });
  } catch (e) {
    return res.status(502).json({ error: 'storage error', detail: String(e.message || e).slice(0, 200) });
  }
};
