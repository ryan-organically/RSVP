// Tiny Turso (libSQL) client over the HTTP pipeline API — zero npm deps, shared by
// the api/* functions. Reads TURSO_URL / TURSO_AUTH_TOKEN from the environment (the
// Vercel Turso integration injects fresh ones at runtime).
const TURSO_URL = (process.env.TURSO_URL || '').trim().replace(/^libsql:/, 'https:').replace(/\/+$/, '');
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();

function configured() { return !!(TURSO_URL && TURSO_TOKEN); }

function toArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number' && Number.isInteger(v)) return { type: 'integer', value: String(v) };
  if (typeof v === 'number') return { type: 'float', value: v };
  return { type: 'text', value: String(v) };
}
function cell(c) {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer') return Number(c.value);
  return c.value;
}

// Run one SQL statement; returns an array of row objects keyed by column name.
async function turso(sql, args = []) {
  const stmt = { sql, args: args.map(toArg) };
  const r = await fetch(TURSO_URL + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TURSO_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
  });
  if (!r.ok) throw new Error('turso http ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const first = (j.results || [])[0];
  if (!first || first.type === 'error') throw new Error('turso: ' + (first?.error?.message || 'query failed'));
  const result = first.response.result;
  return result.rows.map(row => Object.fromEntries(result.cols.map((c, i) => [c.name, cell(row[i])])));
}

module.exports = { turso, configured };
