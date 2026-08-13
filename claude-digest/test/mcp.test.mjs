// Tests the Focal MCP server over its real stdio transport: spawn it, speak JSON-RPC,
// read the replies. No mocking of the protocol layer, because the protocol layer is
// exactly the part that breaks (a stray byte on stdout corrupts a whole session).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', '..', 'mcp', 'index.js');

let pass = 0, fail = 0;
const ck = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, x === undefined ? '' : String(x).slice(0, 240)); }
};

// A stand-in focal.wiki, so focal_read_url is exercised without touching the network.
const upstream = http.createServer((req, res) => {
  if (req.url.startsWith('/api/read')) {
    const target = new URL(req.url, 'http://x').searchParams.get('url');
    if (target.includes('nope')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'host is not on the allowlist' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      source: 'wikipedia', url: target, title: 'Test Article', byline: 'A. Writer',
      words: 5, chars: 26, text: 'Alpha beta gamma delta epsilon. ' + 'padding word '.repeat(60),
    }));
  }
  res.writeHead(404).end();
});
await new Promise(r => upstream.listen(0, r));
const ORIGIN = `http://127.0.0.1:${upstream.address().port}`;

// ---- client ---------------------------------------------------------------
const proc = spawn('node', [SERVER], {
  env: { ...process.env, FOCAL_ORIGIN: ORIGIN },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stdoutBuf = '', stderrBuf = '';
const pending = new Map();
proc.stdout.on('data', chunk => {
  stdoutBuf += chunk;
  let i;
  while ((i = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, i).trim();
    stdoutBuf = stdoutBuf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { ck('stdout carried non-JSON', false, line); continue; }
    const r = pending.get(msg.id);
    if (r) { pending.delete(msg.id); r(msg); }
  }
});
proc.stderr.on('data', c => { stderrBuf += c; });

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + method)), 8000);
    pending.set(id, m => { clearTimeout(timer); resolve(m); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const notify = (method, params) =>
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

// ---- handshake ------------------------------------------------------------
console.log('\nMCP handshake');
{
  const r = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  ck('initialize returns a result', !!r.result, JSON.stringify(r).slice(0, 160));
  ck('echoes back the protocol version the client asked for',
     r.result.protocolVersion === '2024-11-05', r.result?.protocolVersion);
  ck('declares the tools capability', !!r.result.capabilities?.tools);
  ck('identifies itself', r.result.serverInfo?.name === 'focal', r.result?.serverInfo);

  notify('notifications/initialized');
  const p = await rpc('ping', {});
  ck('ping is answered after the initialized notification', !!p.result && !p.error);

  const unknown = await rpc('nonsense/method', {});
  ck('an unknown method is a JSON-RPC error, not a crash', unknown.error?.code === -32601, unknown.error);
}

console.log('\ntools/list');
{
  const r = await rpc('tools/list', {});
  const names = (r.result?.tools || []).map(t => t.name).sort();
  ck('lists focal_open and focal_read_url', JSON.stringify(names) === '["focal_open","focal_read_url"]', names);
  const open = r.result.tools.find(t => t.name === 'focal_open');
  ck('focal_open requires text', JSON.stringify(open.inputSchema.required) === '["text"]', open.inputSchema.required);
  ck('every tool has a description an agent could act on',
     r.result.tools.every(t => typeof t.description === 'string' && t.description.length > 80));
}

console.log('\nfocal_open');
{
  const r = await rpc('tools/call', {
    name: 'focal_open',
    arguments: { text: 'Alpha beta gamma delta.', title: 'My Digest', wpm: 500, open: false },
  });
  const text = r.result?.content?.[0]?.text || '';
  ck('returns a focal link', /#t=[A-Za-z0-9_-]+/.test(text), text.slice(0, 120));
  ck('reports the word count', /4 words/.test(text), text.slice(0, 120));
  ck('carries the title and wpm in the fragment', /ti=My%20Digest/.test(text) && /wpm=500/.test(text), text);

  // The link must actually round-trip back to the original text.
  const frag = text.match(/#t=([A-Za-z0-9_-]+)/)[1];
  const b64 = frag.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((frag.length + 3) % 4);
  const back = inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8');
  ck('the fragment decompresses to exactly the input text', back === 'Alpha beta gamma delta.', back);

  ck('no query string, so the text cannot reach a server',
     new URL(text.split('\n').pop()).search === '');

  const empty = await rpc('tools/call', { name: 'focal_open', arguments: { text: '   ' } });
  ck('empty text is a tool error, not a protocol error',
     empty.result?.isError === true && /empty/.test(empty.result.content[0].text), empty.result);

  const huge = await rpc('tools/call', {
    name: 'focal_open',
    arguments: { text: Array.from({ length: 300000 }, (_, i) => 'w' + i).join(' '), open: false },
  });
  ck('text too long for a link fails with a useful message',
     huge.result?.isError === true && /too long/.test(huge.result.content[0].text),
     huge.result?.content?.[0]?.text);
}

console.log('\nfocal_read_url');
{
  const r = await rpc('tools/call', {
    name: 'focal_read_url', arguments: { url: 'https://en.wikipedia.org/wiki/Test' },
  });
  const text = r.result?.content?.[0]?.text || '';
  ck('returns metadata and a link', /Title: Test Article/.test(text) && /#t=/.test(text), text.slice(0, 200));
  ck('names the source and word count', /Source: wikipedia/.test(text), text.slice(0, 200));
  ck('does NOT dump the prose into the agent context by default',
     !/padding word padding word/.test(text), text.slice(0, 200));

  const withText = await rpc('tools/call', {
    name: 'focal_read_url',
    arguments: { url: 'https://en.wikipedia.org/wiki/Test', include_text: true, max_chars: 600 },
  });
  const t2 = withText.result.content[0].text;
  ck('include_text returns the prose', /Alpha beta gamma/.test(t2));
  ck('max_chars truncates and says so', /truncated at 600 of/.test(t2), t2.slice(-120));

  const bad = await rpc('tools/call', { name: 'focal_read_url', arguments: { url: 'ftp://x/y' } });
  ck('a non-https url is refused', bad.result?.isError === true && /https/.test(bad.result.content[0].text));

  const refused = await rpc('tools/call', {
    name: 'focal_read_url', arguments: { url: 'https://nope.example.com/x' } });
  ck('an upstream refusal is surfaced verbatim',
     refused.result?.isError === true && /allowlist/.test(refused.result.content[0].text),
     refused.result?.content?.[0]?.text);

  const unknown = await rpc('tools/call', { name: 'focal_nope', arguments: {} });
  ck('an unknown tool is a tool error', unknown.result?.isError === true && /unknown tool/.test(unknown.result.content[0].text));
}

console.log('\nprotocol hygiene');
{
  ck('nothing was written to stdout that was not a JSON-RPC message', stdoutBuf.trim() === '', stdoutBuf);
  ck('stderr stayed quiet', stderrBuf.trim() === '', stderrBuf.slice(0, 200));
}

proc.stdin.end();
upstream.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
