// Tests the CLI --sync flag against a throwaway local server: it must POST the digest
// with a bearer token, and the synced id must match the id injected into the HTML.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'claude-digest.js');
const out = join(__dirname, '..', '..', 'node_modules', '.cache-cli-sync-out.html');

let received = null;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    received = { method: req.method, auth: req.headers.authorization, body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
});
await new Promise(r => srv.listen(0, r));
const port = srv.address().port;

const digest = JSON.stringify({ title: 'Sync Test Digest', project: 'rsvp', blocks: [{ tag: 'done', text: 'shipped sync' }, { tag: 'info', text: 'across devices' }] });
await new Promise((resolve, reject) => {
  const p = spawn('node', [CLI, '--inject', '--sync', '-f', 'rsvp', '-o', out], {
    env: { ...process.env, SYNC_TOKEN: 'secret123', FOCAL_SYNC_URL: `http://127.0.0.1:${port}/api/digests` },
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  p.on('close', code => code === 0 ? resolve() : reject(new Error('exit ' + code)));
  p.stdin.write(digest); p.stdin.end();
});
srv.close();

let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, JSON.stringify(x) ?? ''); } };
ck('server received a POST', received && received.method === 'POST', received?.method);
ck('bearer token forwarded', received?.auth === 'Bearer secret123', received?.auth);
ck('body has id+title+blocks', !!received?.body.id && received.body.title === 'Sync Test Digest' && received.body.blocks.length === 2, received?.body);
const html = readFileSync(out, 'utf8');
const injected = JSON.parse(html.match(/_injectedDigest = (\{[\s\S]*?\});\n/)[1]);
ck('injected HTML id === synced id (no divergence)', injected.id === received.body.id, { injected: injected.id, synced: received.body.id });
ck('injected blocks === synced blocks', JSON.stringify(injected.blocks) === JSON.stringify(received.body.blocks));
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
