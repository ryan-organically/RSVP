// Tests api/digests.js against an in-memory Turso mock (no network, no real DB).
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
  if (/^CREATE/i.test(sql)) return ok();
  if (/^INSERT/i.test(sql)) {
    const [id, owner, title, project, time, blocks, created] = a;
    const i = store.findIndex(r => r.id === id && r.owner === owner);
    const row = { id, owner, title, project, time, blocks, created: Number(created) };
    if (i >= 0) store[i] = row; else store.push(row);
    return ok();
  }
  if (/^SELECT/i.test(sql)) {
    const owner = a[0];
    const rows = store.filter(r => r.owner === owner).sort((x, y) => y.created - x.created).slice(0, 100)
      .map(r => [r.id, r.title, r.project, r.time, r.blocks].map(v => ({ type: 'text', value: v })));
    return ok(['id', 'title', 'project', 'time', 'blocks'], rows);
  }
  if (/^DELETE/i.test(sql)) { const [owner, id] = a; const i = store.findIndex(r => r.owner === owner && r.id === id); if (i >= 0) store.splice(i, 1); return ok(); }
  return ok();
};

const fn = (await import(join(__dirname, '..', '..', 'api', 'digests.js'))).default;

function mkRes() { const res = { _b: null, _h: {}, statusCode: 0 };
  res.setHeader = (k, v) => { res._h[k] = v; };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res._b = b; return res; };
  res.end = () => res; return res; }
async function call(method, { auth, body, query } = {}) {
  const req = { method, headers: {}, query: query || {}, url: '/api/digests' + (query?.id ? '?id=' + query.id : '') };
  if (auth) req.headers.authorization = 'Bearer ' + auth;
  if (body !== undefined) req.body = body;
  const res = mkRes(); await fn(req, res); return res;
}

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, JSON.stringify(x) ?? ''); } };

ck('no token → 401', (await call('GET', {})).statusCode === 401);
ck('wrong token → 401', (await call('GET', { auth: 'nope' })).statusCode === 401);
let r = await call('GET', { auth: 'secret123' });
ck('GET authed empty → 200 + []', r.statusCode === 200 && Array.isArray(r._b) && r._b.length === 0, r._b);
const dg = { id: 'demo-1', title: 'Hello', project: 'p', time: '2026-06-26T00:00:00Z', blocks: [{ tag: 'info', text: 'one' }, { tag: 'info', text: 'two' }] };
r = await call('POST', { auth: 'secret123', body: dg });
ck('POST stores → ok', r.statusCode === 200 && r._b.ok === true, r._b);
ck('POST bad (no blocks) → 400', (await call('POST', { auth: 'secret123', body: { id: 'x' } })).statusCode === 400);
r = await call('GET', { auth: 'secret123' });
ck('GET returns digest, blocks parsed', r._b.length === 1 && r._b[0].id === 'demo-1' && r._b[0].blocks.length === 2 && r._b[0].blocks[0].text === 'one', r._b);
ck('CORS header present', !!r._h['Access-Control-Allow-Origin']);
ck('OPTIONS preflight → 204', (await call('OPTIONS', {})).statusCode === 204);
ck('non-matching token → 401 (single shared secret)', (await call('GET', { auth: 'someoneelse' })).statusCode === 401);
r = await call('DELETE', { auth: 'secret123', query: { id: 'demo-1' } });
ck('DELETE removes it', r.statusCode === 200 && r._b.ok === true);
ck('GET empty after delete', (await call('GET', { auth: 'secret123' }))._b.length === 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
