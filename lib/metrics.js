// Aggregate-only usage counters.
//
// What this deliberately is NOT: client-side telemetry. There is no beacon, no
// visitor id, no session id, no IP, no user agent, and no client code anywhere that
// reports anything. The app keeps working with zero credentials and zero round-trips,
// and the "nothing leaves your browser" promise on the landing page and in embed.html
// stays literally true.
//
// What it IS: the server counting requests it already served, bucketed by day and by
// one low-cardinality dimension, into integer totals. `/api/read` calls, by source.
// That is enough to chart whether the reader routes are being used at all, and not
// enough to say anything about any individual.
//
// Reads are gated behind SYNC_TOKEN (see api/metrics.js). Writes happen server-side
// only — no route accepts a counter from a caller, so nobody can inflate them.
const { turso, configured } = require('./turso.js');

let _ready = null;

function ensureSchema() {
  return turso(`CREATE TABLE IF NOT EXISTS metrics(
      day TEXT NOT NULL, event TEXT NOT NULL, dim TEXT NOT NULL DEFAULT '',
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, event, dim))`);
}

const today = () => new Date().toISOString().slice(0, 10);

// Low-cardinality guard: a dimension is a short enum-ish label, never free text and
// never anything caller-controlled that could carry a URL, a path, or an identifier.
const clean = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);

// Fire and forget, but awaited: serverless can kill un-awaited work mid-flight.
// Never throws, never blocks the response on a storage failure, never logs the row.
async function record(event, dim = '') {
  if (!configured()) return false;                 // local/dev: silently no-op
  try {
    _ready = _ready || ensureSchema();
    await _ready;
    await turso(
      `INSERT INTO metrics(day, event, dim, n) VALUES(?,?,?,1)
       ON CONFLICT(day, event, dim) DO UPDATE SET n = n + 1`,
      [today(), clean(event), clean(dim)]);
    return true;
  } catch {
    return false;                                  // counting is never worth an error
  }
}

async function read(days = 30) {
  if (!configured()) return [];
  _ready = _ready || ensureSchema();
  await _ready;
  const since = new Date(Date.now() - Math.min(365, Math.max(1, days)) * 86400000)
    .toISOString().slice(0, 10);
  return turso(`SELECT day, event, dim, n FROM metrics WHERE day >= ? ORDER BY day DESC, n DESC`, [since]);
}

module.exports = { record, read, clean };
