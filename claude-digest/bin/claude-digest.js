#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { writeFile, readFileSync, copyFileSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { findCurrentTranscript, parseTranscriptChunks, parseLastResponse } from '../src/transcript.js';
import { formatRSVP, buildSession } from '../src/formats/rsvp.js';
import { formatJSON } from '../src/formats/json.js';
import { formatMarkdown } from '../src/formats/markdown.js';
import { formatHTML } from '../src/formats/html.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    parse:   { type: 'boolean', default: false },
    last:    { type: 'boolean', default: false },
    file:    { type: 'string' },
    inject:  { type: 'boolean', default: false },
    open:    { type: 'boolean', default: false },
    sync:    { type: 'boolean', default: false },
    'no-sync': { type: 'boolean', default: false },
    phone:   { type: 'boolean', default: false },
    format:  { type: 'string', short: 'f', default: 'json' },
    output:  { type: 'string', short: 'o' },
    help:    { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`claude-digest - Fast Dev Digest from Claude Code sessions

Usage:
  claude-digest --last --open            Mirror the most recent response verbatim → RSVP Reader
  claude-digest --file <path> --open     Mirror any text/markdown file → RSVP Reader
  claude-digest --parse                  Parse current session → JSON chunks to stdout
  echo '<json>' | claude-digest --inject --open   Format digest and open in RSVP Reader

Options:
  --last                Read the latest assistant response verbatim and open it in RSVP
  --file <path>         Read a file (text/markdown) and open it in RSVP
  --sync                Push to focal.wiki (now the DEFAULT when $SYNC_TOKEN is set; flag kept for compatibility, forces the skip warning if the token is missing)
  --no-sync             Skip the automatic focal.wiki sync for this run
  --parse               Parse transcript, output chunks as JSON
  --inject              Read digest JSON from stdin, format it
  --open                Open formatted output in browser
  --phone               Also Taildrop the digest HTML to your tailnet phone (opt-in)
  -f, --format <type>   json | markdown | html | rsvp (default: json)
  -o, --output <path>   Write to file instead of stdout
  -h, --help            Show this help`);
  process.exit(0);
}

// Turn the verbatim last response into RSVP blocks: one block per paragraph / list
// item / heading, with markdown syntax stripped so the prose reads cleanly word-by-word.
function responseToBlocks(text) {
  const clean = (s) => s
    .replace(/`([^`]*)`/g, '$1')                 // inline code → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // bold
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')     // italics
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // links → label
    .replace(/^\s{0,3}#{1,6}\s+/, '')            // headings
    .replace(/^\s*[-*•]\s+/, '')                 // bullets
    .replace(/^\s*\d+[.)]\s+/, '')               // numbered list
    .replace(/^\s*>\s?/, '')                     // blockquote
    .replace(/\s+/g, ' ')
    .trim();
  const blocks = [];
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) continue;          // skip code-fence markers
    const c = clean(line);
    if (c) blocks.push({ tag: 'info', text: c });
  }
  return blocks;
}

async function main() {
  if (values.last) {
    // Mirror the most recent response verbatim into RSVP — no summarization.
    const transcriptPath = await findCurrentTranscript();
    if (!transcriptPath) { console.error('No session transcript found.'); process.exit(1); }
    const { text, meta } = await parseLastResponse(transcriptPath);
    if (!text) { console.error('No assistant response found to mirror.'); process.exit(1); }
    const blocks = responseToBlocks(text);
    if (!blocks.length) { console.error('Response had no readable text.'); process.exit(1); }
    let project = 'session';
    try { project = basename(execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
    catch { project = basename(process.cwd()); }
    const title = blocks[0].text.split(' ').slice(0, 7).join(' ').slice(0, 60) || 'Latest response';
    const digest = { title, project, blocks };
    const session = buildSession(digest, { timestamp: meta.timestamp || new Date().toISOString() });
    const output = await formatRSVP(digest, {}, session);
    if (!values['no-sync']) await syncDigest(session);
    await taildropDigest(output, digest.title);
    if (values.output) {
      await writeFileAsync(values.output, output, 'utf-8');
    } else if (values.open) {
      const tmpPath = join(tmpdir(), `claude-digest-${Date.now()}.html`);
      await writeFileAsync(tmpPath, output, 'utf-8');
      openBrowser(tmpPath);
      console.error(`Opened: ${tmpPath}`);
    } else {
      console.log(output);
    }
    return;
  }

  const filePath = values.file || (positionals.length && !values.parse && !values.inject ? positionals[0] : null);
  if (filePath) {
    // Mirror a file verbatim into RSVP — headless `digest <path>` entry point.
    let raw;
    try { raw = readFileSync(filePath, 'utf-8'); }
    catch (e) { console.error(`Cannot read ${filePath}: ${e.message}`); process.exit(1); }
    const blocks = responseToBlocks(raw);
    if (!blocks.length) { console.error('File had no readable text.'); process.exit(1); }
    let project = 'file';
    try { project = basename(execSync(`git -C "${dirname(filePath)}" rev-parse --show-toplevel`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
    catch { project = basename(dirname(resolve(filePath))) || 'file'; }
    const digest = { title: basename(filePath), project, blocks };
    const session = buildSession(digest, { timestamp: new Date().toISOString() });
    const output = await formatRSVP(digest, {}, session);
    if (!values['no-sync']) await syncDigest(session);
    await taildropDigest(output, digest.title);
    if (values.output) {
      await writeFileAsync(values.output, output, 'utf-8');
    } else if (values.open) {
      const tmpPath = join(tmpdir(), `claude-digest-${Date.now()}.html`);
      await writeFileAsync(tmpPath, output, 'utf-8');
      openBrowser(tmpPath);
      console.error(`Opened: ${tmpPath}`);
    } else {
      console.log(output);
    }
    return;
  }

  if (values.parse) {
    // Parse mode: find transcript, output chunks as JSON
    const transcriptPath = await findCurrentTranscript();
    if (!transcriptPath) { console.error('No session transcript found.'); process.exit(1); }
    const { chunks, meta } = await parseTranscriptChunks(transcriptPath);
    if (!chunks.length) { console.error('Empty session.'); process.exit(1); }
    let repoRoot;
    try { repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { repoRoot = process.cwd(); }
    console.log(JSON.stringify({ project: basename(repoRoot), chunks, meta }));
    return;
  }

  if (values.inject) {
    const input = await readStdin();
    const digest = JSON.parse(input);
    const meta = { timestamp: new Date().toISOString() };
    const fmt = values.open ? 'rsvp' : values.format;

    const session = buildSession(digest, meta);
    let output;
    switch (fmt) {
      case 'markdown': case 'md': output = formatMarkdown(digest, meta); break;
      case 'html': output = formatHTML(digest, meta); break;
      case 'rsvp': output = await formatRSVP(digest, meta, session); break;
      case 'json': default: output = formatJSON(digest, meta); break;
    }

    if (!values['no-sync']) await syncDigest(session);
    if (fmt === 'rsvp') await taildropDigest(output, digest.title);
    if (values.open) {
      const tmpPath = join(tmpdir(), `claude-digest-${Date.now()}.html`);
      await writeFileAsync(tmpPath, output, 'utf-8');
      openBrowser(tmpPath);
      console.error(`Opened: ${tmpPath}`);
    } else if (values.output) {
      await writeFileAsync(values.output, output, 'utf-8');
    } else {
      console.log(output);
    }
    return;
  }

  console.error('Use --parse or --inject. Run with --help for info.');
  process.exit(1);
}

// Opt-in extra: --phone Taildrops the digest HTML to a tailnet device.
// Device name comes from $DIGEST_TAILDROP or ~/.config/claude-digest/config.json
// ({"taildrop": "<device>"}). Primary mobile delivery is the focal.wiki sync (default).
function taildropDevice() {
  const env = (process.env.DIGEST_TAILDROP || '').trim();
  if (env) return env;
  try {
    const cfg = JSON.parse(readFileSync(join(process.env.HOME || '', '.config', 'claude-digest', 'config.json'), 'utf-8'));
    if (cfg.taildrop) return String(cfg.taildrop).trim();
  } catch { /* unconfigured */ }
  return null;
}

async function taildropDigest(output, title) {
  if (!values.phone) return;
  const device = taildropDevice();
  if (!device) {
    console.error('Taildrop skipped: set $DIGEST_TAILDROP or {"taildrop":"<device>"} in ~/.config/claude-digest/config.json');
    return;
  }
  const slug = (title || 'digest').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'digest';
  const stamp = new Date().toISOString().slice(11, 16).replace(':', '');
  const dropPath = join(tmpdir(), `${slug}-${stamp}.html`);
  await writeFileAsync(dropPath, output, 'utf-8');
  try {
    execSync(`tailscale file cp "${dropPath}" "${device}:"`, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 15000 });
    console.error(`Taildropped to ${device}: ${basename(dropPath)}`);
  } catch (e) {
    console.error(`Taildrop to ${device} failed: ${(e.stderr || e.message || '').toString().trim().slice(0, 160)}`);
  }
}

// Push a digest to your focal.wiki instance so it shows up on every device.
// Token from $SYNC_TOKEN (or $FOCAL_SYNC_TOKEN); endpoint from $FOCAL_SYNC_URL.
async function syncDigest(session) {
  const url = process.env.FOCAL_SYNC_URL || 'https://focal.wiki/api/digests';
  const token = (process.env.SYNC_TOKEN || process.env.FOCAL_SYNC_TOKEN || '').trim();
  if (!token) { if (values.sync) console.error('Sync skipped: set $SYNC_TOKEN to push to focal.wiki.'); return; }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
    if (r.ok) console.error(`Synced to ${url}`);
    else console.error(`Sync failed: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  } catch (e) {
    console.error('Sync failed: ' + (e.message || e));
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

function openBrowser(filePath) {
  const plat = platform();
  const isWSL = (() => {
    try { return readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft'); } catch { return false; }
  })();

  try {
    if (isWSL) {
      const winPath = `/mnt/c/temp-digest-${Date.now()}.html`;
      copyFileSync(filePath, winPath);
      const dosPath = winPath.replace('/mnt/c/', 'C:\\').replace(/\//g, '\\');
      execSync(`powershell.exe -Command "Start-Process '${dosPath}'"`, { stdio: 'ignore' });
    } else if (plat === 'darwin') {
      execSync(`open "file://${filePath}"`);
    } else if (plat === 'win32') {
      execSync(`start "" "file://${filePath}"`);
    } else {
      execSync(`xdg-open "file://${filePath}" 2>/dev/null || sensible-browser "file://${filePath}" 2>/dev/null`);
    }
  } catch {
    console.error(`Could not open browser. Open manually: ${filePath}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
