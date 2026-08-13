// Tests the CLI --sync flag against a throwaway local server: it must POST the digest
// with a bearer token, then READ IT BACK before claiming success, and the synced id must
// match the id injected into the HTML.
//
// The read-back is the point (2026-08-08): a POST once returned 2xx while the row never
// became visible, so the CLI printed "Synced" and the digest silently missed the phone.
// Both halves are asserted here — the happy path must say VERIFIED, and a server that
// accepts the push but does not list the row must be reported as a phantom, not a success.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'claude-digest.js');
// Scratch output in the OS temp dir — this is a zero-dependency project, so node_modules/ may not exist.
const out = join(tmpdir(), 'cli-sync-out-' + process.pid + '.html');

// Run the CLI against a mock focal.wiki. `listBack` decides what the read-back GET
// returns, which is how we simulate a phantom write.
async function run({ listBack }) {
  const requests = [];
  const stored = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, auth: req.headers.authorization, body: parsed });
      if (req.method === 'POST') {
        stored.push(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listBack(stored)));
    });
  });
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;

  const digest = JSON.stringify({
    title: 'Sync Test Digest', project: 'rsvp',
    blocks: [{ tag: 'done', text: 'shipped sync' }, { tag: 'info', text: 'across devices' }],
  });
  let stderr = '';
  await new Promise((resolve, reject) => {
    const p = spawn('node', [CLI, '--inject', '--sync', '-f', 'rsvp', '-o', out], {
      env: { ...process.env, SYNC_TOKEN: 'secret123', FOCAL_SYNC_URL: `http://127.0.0.1:${port}/api/digests` },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    p.stderr.on('data', c => { stderr += c; });
    p.on('close', code => code === 0 ? resolve() : reject(new Error('exit ' + code)));
    p.stdin.write(digest); p.stdin.end();
  });
  srv.close();
  return { requests, stderr };
}

let pass = 0, fail = 0;
const ck = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m', n); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', n, x === undefined ? '' : JSON.stringify(x)); }
};

// ---- happy path: server lists the digest back --------------------------------
const ok = await run({ listBack: stored => stored });
const post = ok.requests.find(r => r.method === 'POST');
const readback = ok.requests.find(r => r.method === 'GET');

ck('server received a POST', !!post, ok.requests.map(r => r.method));
ck('bearer token forwarded on the push', post?.auth === 'Bearer secret123', post?.auth);
ck('body has id+title+blocks',
   !!post?.body.id && post.body.title === 'Sync Test Digest' && post.body.blocks.length === 2, post?.body);
ck('the push is verified by a read-back GET', !!readback, ok.requests.map(r => r.method));
ck('bearer token forwarded on the read-back', readback?.auth === 'Bearer secret123', readback?.auth);
ck('success is reported as VERIFIED', /VERIFIED by read-back/.test(ok.stderr), ok.stderr.trim().slice(0, 160));
ck('the account fingerprint is printed, never the token',
   /\[account [0-9a-f]{8}\]/.test(ok.stderr) && !ok.stderr.includes('secret123'), ok.stderr.trim().slice(0, 160));

const html = readFileSync(out, 'utf8');
const injected = JSON.parse(html.match(/_injectedDigest = (\{[\s\S]*?\});\n/)[1]);
ck('injected HTML id === synced id (no divergence)', injected.id === post?.body.id,
   { injected: injected.id, synced: post?.body.id });
ck('injected blocks === synced blocks', JSON.stringify(injected.blocks) === JSON.stringify(post?.body.blocks));

// ---- phantom write: server accepts the push but never lists the row ----------
const phantom = await run({ listBack: () => [] });
ck('a phantom write is NOT reported as success', !/VERIFIED/.test(phantom.stderr), phantom.stderr.trim().slice(0, 160));
ck('a phantom write is reported as a failure', /SYNC FAILED \(phantom\)/.test(phantom.stderr),
   phantom.stderr.trim().slice(0, 200));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
