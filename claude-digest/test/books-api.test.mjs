// Tests api/books.js against an in-memory Turso mock. Covers metadata-only sync,
// full-text sync for imported books, the oversize→metadata-only guard, and self-heal GET.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.TURSO_URL = 'https://fake.turso.io';
process.env.TURSO_AUTH_TOKEN = 'faketoken';
process.env.SYNC_TOKEN = 'secret123';

const store = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('/v2/pipeline')) return realFetch(url, opts);
  const stmt = JSON.parse(opts.body).requests[0].stmt;
  const sql = stmt.sql.trim();
  const a = (stmt.args || []).map(x => x.type === 'null' ? null : x.value);
  const ok = (cols = [], rows = []) => ({ ok: true, json: async () => ({ results: [
    { type: 'ok', response: { type: 'execute', result: { cols: cols.map(n => ({ name: n })), rows } } },
    { type: 'ok' }] }) });
  const R = (vals) => vals.map(v => v == null ? { type: 'null' } : (typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: v }));
  if (/^CREATE/i.test(sql)) return ok();
  if (/^INSERT/i.test(sql)) {
    const [id, owner, meta, text, has_text, updated] = a;
    const i = store.findIndex(r => r.id === id && r.owner === owner);
    const row = { id, owner, meta, text, has_text: Number(has_text), updated: Number(updated) };
    if (i >= 0) store[i] = row; else store.push(row);
    return ok();
  }
  if (/^SELECT/i.test(sql)) {
    if (/AND id=\?/.test(sql)) { // by-id (with text)
      const [owner, id] = a;
      const row = store.find(r => r.owner === owner && r.id === id);
      return ok(['id', 'meta', 'text'], row ? [R([row.id, row.meta, row.text])] : []);
    }
    const owner = a[0]; // list (has_text, no text)
    const rows = store.filter(r => r.owner === owner).sort((x, y) => y.updated - x.updated)
      .map(r => R([r.id, r.meta, r.has_text]));
    return ok(['id', 'meta', 'has_text'], rows);
  }
  if (/^DELETE/i.test(sql)) { const [owner, id] = a; const i = store.findIndex(r => r.owner === owner && r.id === id); if (i >= 0) store.splice(i, 1); return ok(); }
  return ok();
};

const fn = (await import(join(__dirname, '..', '..', 'api', 'books.js'))).default;
function mkRes() { const res = { _b: null, _h: {}, statusCode: 0 };
  res.setHeader = (k, v) => { res._h[k] = v; }; res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res._b = b; return res; }; res.end = () => res; return res; }
async function call(method, { auth, body, id } = {}) {
  const req = { method, headers: {}, query: id ? { id } : {}, url: '/api/books' + (id ? '?id=' + id : '') };
  if (auth) req.headers.authorization = 'Bearer ' + auth;
  if (body !== undefined) req.body = body;
  const res = mkRes(); await fn(req, res); return res;
}

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, JSON.stringify(x) ?? ''); } };

ck('no token → 401', (await call('GET', {})).statusCode === 401);
ck('GET authed empty → []', (await call('GET', { auth: 'secret123' }))._b.length === 0);

// a Gutenberg book: metadata only (text re-heals from gutenId)
let r = await call('POST', { auth: 'secret123', body: { id: 'g1', meta: { id: 'g1', title: 'Moby Dick', source: 'gutenberg', gutenId: 2701 } } });
ck('POST gutenberg meta → ok, no text stored', r._b.ok === true && r._b.text_stored === false, r._b);

// an imported book: full text stored
r = await call('POST', { auth: 'secret123', body: { id: 'i1', meta: { id: 'i1', title: 'My Notes', source: 'import' }, text: 'the quick brown fox' } });
ck('POST imported with text → text_stored true', r._b.ok === true && r._b.text_stored === true, r._b);

// oversize text → metadata only
const huge = 'x'.repeat(4_000_000);
r = await call('POST', { auth: 'secret123', body: { id: 'big', meta: { id: 'big', title: 'Huge', source: 'import' }, text: huge } });
ck('oversize text → stored as metadata only', r._b.text_stored === false, r._b);

r = await call('GET', { auth: 'secret123' });
ck('GET list returns all 3, light (has_text flags)', r._b.length === 3 && r._b.find(b => b.id === 'i1').has_text === true && r._b.find(b => b.id === 'g1').has_text === false, r._b.map(b => [b.id, b.has_text]));
ck('list omits text payload', r._b.every(b => !('text' in b)));

r = await call('GET', { auth: 'secret123', id: 'i1' });
ck('GET ?id= returns full text (self-heal)', r._b.text === 'the quick brown fox' && r._b.meta.title === 'My Notes', r._b);
ck('GET ?id= for gutenberg returns empty text', (await call('GET', { auth: 'secret123', id: 'g1' }))._b.text === '');
ck('GET ?id= missing → 404', (await call('GET', { auth: 'secret123', id: 'nope' })).statusCode === 404);

ck('DELETE removes a book', (await call('DELETE', { auth: 'secret123', id: 'i1' }))._b.ok === true);
ck('GET after delete → 2 left', (await call('GET', { auth: 'secret123' }))._b.length === 2);
ck('POST invalid (no meta) → 400', (await call('POST', { auth: 'secret123', body: { id: 'x' } })).statusCode === 400);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
