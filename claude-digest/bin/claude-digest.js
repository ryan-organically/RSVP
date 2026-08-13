#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { writeFile, readFileSync, copyFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir, platform, homedir } from 'node:os';
import { execSync, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findCurrentTranscript, parseTranscriptChunks, parseLastResponse, collectUuids } from '../src/transcript.js';
import { formatRSVP, buildSession } from '../src/formats/rsvp.js';
import { formatJSON } from '../src/formats/json.js';
import { formatMarkdown } from '../src/formats/markdown.js';
import { formatHTML } from '../src/formats/html.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    parse:   { type: 'boolean', default: false },
    last:    { type: 'boolean', default: false },
    transcript: { type: 'string' },
    exact:   { type: 'boolean', default: false },
    file:    { type: 'string' },
    inject:  { type: 'boolean', default: false },
    open:    { type: 'boolean', default: false },
    'force-open': { type: 'boolean', default: false },
    full:    { type: 'boolean', default: false },
    mini:    { type: 'boolean', default: false },
    sync:    { type: 'boolean', default: false },
    'no-sync': { type: 'boolean', default: false },
    phone:   { type: 'boolean', default: false },
    ticket:  { type: 'string', multiple: true },
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
  --open                Open in the default browser (full tab — the proven flow).
                        Skipped when the auto-digest Stop hook already opened this
                        exact response in the last 10 minutes (no duplicate tabs).
  --force-open          Open even if the same response was just auto-opened
  --mini                BROKEN/UNPROVEN: experimental 500x500 bottom-right app window.
                        Windows landed on unreachable virtual desktops in testing; kept
                        opt-in only until that's solved. --full is a no-op (old default).
  --phone               Also Taildrop the digest HTML to your tailnet phone (opt-in)
  --ticket <id>         Tag the digest with a Malleable kanban ticket (repeatable).
                        Without the flag, tickets whose UUIDs appear in the session
                        transcript are associated automatically; the repo's linked
                        Malleable bucket is always tagged when one exists.
  -f, --format <type>   json | markdown | html | rsvp (default: json)
  -o, --output <path>   Write to file instead of stdout
  -h, --help            Show this help`);
  process.exit(0);
}

// Classify a line of the response into the reader's tag vocabulary (see TAG_COLORS
// in public/index.html: done / high / critical / decision / info). Rules run on the
// RAW markdown line, in order — first match wins. Past-tense accomplishment beats
// the brokenness it describes ("Fixed the broken sync" → done), alarm words beat
// open-work words, and anything unmatched stays plain info.
const TAG_RULES = [
  ['decision', /\b(decision|decided|verdict|chose|opted (for|to)|recommend(ed|ation)?|your call|trade-?offs?)\b/i],
  ['done',     /\b(shipped|fixed|fixes|deployed|merged|implemented|resolved|completed|verified|confirmed|landed|green|passing)\b/i],
  ['done',     /^\s*(?:[-*•]\s+|\d+[.)]\s+|#{1,6}\s+|\*\*)?(added|built|created|wrote|wired|removed|updated|renamed|refactored)\b/i],
  ['critical', /\b(broken|breaks|crash(es|ed)?|regression|security|vulnerab\w*|data loss|corrupt\w*|fail(s|ed|ing)?|error(s|ed)?|do not|banned)\b/i],
  ['high',     /\b(todo|next steps?|next up|remaining|awaiting|blocked|pending|caveats?|gotchas?|warning|not yet|open question|follow-?ups?|needs|still|unproven|human-gated|your (approval|review))\b/i],
];
function classifyLine(rawLine) {
  for (const [tag, re] of TAG_RULES) { if (re.test(rawLine)) return tag; }
  return 'info';
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
    if (c) blocks.push({ tag: classifyLine(line), text: c });
  }
  return blocks;
}

// ── Malleable tagging: which bucket (and which kanban tickets) a digest belongs to ──
// Bucket comes from the repo↔bucket link (`mal buckets current --json`), cached per
// repo root so routine digests don't pay a network call. Tickets are found by
// intersecting UUIDs that appear anywhere in the session transcript with the actual
// task list — exact, no guessing. Everything here is best-effort: no `mal`, no link,
// or a timeout simply leaves the digest untagged.
const CFG_DIR = join(homedir(), '.config', 'claude-digest');
const CACHE_FILE = join(CFG_DIR, 'cache.json');
const BUCKET_TTL_HIT_MS = 7 * 24 * 3600 * 1000;   // linked buckets barely ever move
const BUCKET_TTL_MISS_MS = 3600 * 1000;           // re-check unlinked repos hourly

function readCacheFile() { try { return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')); } catch { return {}; } }
function writeCacheFile(c) { try { mkdirSync(CFG_DIR, { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2)); } catch {} }

function repoRootFor(dir) {
  try { return execSync(`git -C "${dir}" rev-parse --show-toplevel`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function malJson(args, opts = {}) {
  const out = execFileSync('mal', args, { encoding: 'utf-8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  const i = out.indexOf('{');
  if (i < 0) throw new Error('no json');
  return JSON.parse(out.slice(i));
}

function resolveBucket(dir) {
  const root = repoRootFor(dir) || resolve(dir);
  const cache = readCacheFile();
  const hit = cache.buckets && cache.buckets[root];
  if (hit && Date.now() - hit.ts < (hit.id ? BUCKET_TTL_HIT_MS : BUCKET_TTL_MISS_MS)) {
    return hit.id ? { id: hit.id, name: hit.name || '' } : null;
  }
  let bucket = null;
  try {
    const j = malJson(['buckets', 'current', '--json'], { cwd: root });
    if (j.ok && j.data && j.data.id) bucket = { id: j.data.id, name: j.data.name || '' };
  } catch { /* mal missing or repo unlinked — digest stays untagged */ }
  cache.buckets = cache.buckets || {};
  cache.buckets[root] = { ...(bucket || {}), ts: Date.now() };
  writeCacheFile(cache);
  return bucket;
}

function resolveTickets(transcriptUuids) {
  const explicit = (values.ticket || []).map(s => s.trim().toLowerCase()).filter(Boolean);
  const wanted = explicit.length ? new Set(explicit) : transcriptUuids;
  if (!wanted || !wanted.size) return [];
  try {
    const j = malJson(['tasks', 'ls', '--json']);
    return (j.data || [])
      .filter(t => t && wanted.has(String(t.id).toLowerCase()))
      .slice(0, 5)
      .map(t => ({ id: t.id, title: t.title || '', stage: t.kanban_stage || '' }));
  } catch { return []; }
}

function digestMeta(bucket, tickets) {
  const meta = {};
  if (bucket) meta.bucket = bucket;
  if (tickets && tickets.length) meta.tickets = tickets;
  return Object.keys(meta).length ? meta : undefined;
}

async function main() {
  if (values.last) {
    // Mirror the most recent response verbatim into RSVP — no summarization.
    // --transcript pins the exact session file (used by the auto-digest Stop hook);
    // --exact takes the literal final response with no fall-back to earlier turns.
    // Open-dedupe: the auto-digest Stop hook and a manual `/digest` can both
    // target the same response (hook fires on >500-word turns, then Ryan runs
    // the skill) — that double-opened tabs on 2026-07-27. Both paths now share
    // one state file: whoever opens records the content hash, and a second
    // --open of the same hash within 10 minutes is skipped (--force-open
    // overrides). Sync/taildrop still run either way.
    const transcriptPath = values.transcript || await findCurrentTranscript();
    if (!transcriptPath) { console.error('No session transcript found.'); process.exit(1); }
    const { text, meta } = await parseLastResponse(transcriptPath, { exact: values.exact });
    if (!text) { console.error('No assistant response found to mirror.'); process.exit(1); }
    const blocks = responseToBlocks(text);
    if (!blocks.length) { console.error('Response had no readable text.'); process.exit(1); }
    const repoRoot = repoRootFor(process.cwd()) || process.cwd();
    const project = basename(repoRoot);
    const title = blocks[0].text.split(' ').slice(0, 7).join(' ').slice(0, 60) || 'Latest response';
    const bucket = resolveBucket(repoRoot);
    const tickets = resolveTickets(await collectUuids(transcriptPath));
    const digest = { title, project, blocks, meta: digestMeta(bucket, tickets) };
    const session = buildSession(digest, { timestamp: meta.timestamp || new Date().toISOString() });
    const output = await formatRSVP(digest, {}, session);
    if (!values['no-sync']) await syncDigest(session);
    await taildropDigest(output, digest.title);
    if (values.output) {
      await writeFileAsync(values.output, output, 'utf-8');
    } else if (values.open) {
      if (!values['force-open'] && wasJustOpened(text)) {
        console.error('Skipped opening: this exact response was already opened in the last 10 minutes (auto-digest Stop hook or a prior run). Pass --force-open to open anyway.');
      } else {
        const tmpPath = join(tmpdir(), `claude-digest-${Date.now()}.html`);
        await writeFileAsync(tmpPath, output, 'utf-8');
        openBrowser(tmpPath);
        recordOpened(text);
        console.error(`Opened: ${tmpPath}`);
      }
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
    const fileRoot = repoRootFor(dirname(filePath));
    const project = fileRoot ? basename(fileRoot) : (basename(dirname(resolve(filePath))) || 'file');
    const bucket = resolveBucket(fileRoot || dirname(resolve(filePath)));
    const tickets = resolveTickets(null); // no transcript in file mode; --ticket still works
    const digest = { title: basename(filePath), project, blocks, meta: digestMeta(bucket, tickets) };
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
    if (!digest.meta) digest.meta = digestMeta(resolveBucket(process.cwd()), resolveTickets(null));
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
//
// Trust-but-verify (2026-08-08): a POST here once returned 2xx while the row
// never became visible — the CLI printed "Synced" and the digest silently
// missed the phone. A sync is only claimed after reading the digest BACK from
// the server by id. The printed account fingerprint is the first 8 hex chars
// of sha256(token) — matching the server's owner-namespace derivation, safe to
// print, and lets any two devices confirm they're on the same account without
// ever comparing the token itself.
function accountFingerprint(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

async function syncDigest(session) {
  const url = process.env.FOCAL_SYNC_URL || 'https://focal.wiki/api/digests';
  const token = (process.env.SYNC_TOKEN || process.env.FOCAL_SYNC_TOKEN || '').trim();
  if (!token) { if (values.sync) console.error('Sync skipped: set $SYNC_TOKEN to push to focal.wiki.'); return; }
  const fp = accountFingerprint(token);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
    if (!r.ok) {
      console.error(`SYNC FAILED (push): HTTP ${r.status} ${(await r.text()).slice(0, 120)} [account ${fp}]`);
      return;
    }
    // Read-back: the digest must be listed under this token before we claim success.
    const check = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const listed = check.ok && (await check.json()).some((d) => d.id === session.id);
    if (listed) console.error(`Synced to ${url} — VERIFIED by read-back [account ${fp}]`);
    else console.error(`SYNC FAILED (phantom): server accepted the push but "${session.id}" is not in the read-back list [account ${fp}]. The digest is NOT on other devices.`);
  } catch (e) {
    console.error(`SYNC FAILED: ${e.message || e} [account ${fp}]`);
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

// Default open: a chromeless 500x500 app window pinned to the bottom-right of the
// primary work area (above the taskbar). --full restores the old full-browser tab.
// The dedicated --user-data-dir makes Chromium honor the geometry flags even when
// the user's main browser is already running (an existing instance ignores them).
const MINI_W = 500, MINI_H = 500, MINI_MARGIN = 16;

function findWindowsBrowser() {
  const candidates = [
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of candidates) { if (existsSync(p)) return p; }
  return null;
}

function windowsWorkArea() {
  try {
    // execFileSync: no shell layer, so PowerShell's $wa survives untouched.
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; $wa=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output $wa.Right $wa.Bottom'],
      { encoding: 'utf-8', timeout: 10000 }
    ).trim().split(/\s+/).map(Number);
    if (out.length === 2 && out.every(n => Number.isFinite(n) && n > 0)) return { right: out[0], bottom: out[1] };
  } catch {}
  return { right: 1920, bottom: 1040 }; // sane fallback if the probe fails
}

// Single-window policy: close the previous mini window before opening the next one.
// A second launch against a live temp-digest-profile instance just hands the URL to it,
// which ignores the geometry flags and opens on whatever virtual desktop the first
// window lives on — windows pile up out of reach. A fresh instance per digest keeps
// exactly one window, honors size/position, and appears on the CURRENT virtual desktop.
// (Filter by browser process name — a bare CommandLine match would catch the querying
// powershell process itself, whose command line contains the profile string.)
function closePreviousMiniWindow() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*temp-digest-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
      { timeout: 10000, stdio: 'ignore' });
  } catch { /* nothing to close, or query failed — launch anyway */ }
}

function openMiniWindowWSL(dosPath) {
  const exe = findWindowsBrowser();
  if (!exe) return false;
  closePreviousMiniWindow();
  const { right, bottom } = windowsWorkArea();
  const x = Math.max(0, right - MINI_W - MINI_MARGIN);
  const y = Math.max(0, bottom - MINI_H - MINI_MARGIN);
  const fileUrl = 'file:///' + dosPath.replace(/\\/g, '/');
  try {
    spawn(exe, [
      `--app=${fileUrl}`,
      `--window-size=${MINI_W},${MINI_H}`,
      `--window-position=${x},${y}`,
      '--user-data-dir=C:\\temp-digest-profile',
      '--no-first-run', '--no-default-browser-check',
      '--hide-crash-restore-bubble', '--disable-session-crashed-bubble',
    ], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

/* Shared open-dedupe state with ~/.claude/hooks/auto-digest.mjs: one file,
   the 16-hex sha256 prefix of the exact response text. The hook reads it to
   avoid reopening on resume/clear/compact; this CLI reads it to avoid a
   duplicate tab right after the hook's auto-open, and writes it on every
   successful --last open. File content stays a bare hash (hook-compatible);
   freshness comes from the file's mtime. */
const AUTO_DIGEST_STATE = join(homedir(), '.claude', 'hooks', '.state', 'auto-digest-last');
const OPEN_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function contentHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function wasJustOpened(text) {
  try {
    if (Date.now() - statSync(AUTO_DIGEST_STATE).mtimeMs > OPEN_DEDUPE_WINDOW_MS) return false;
    return readFileSync(AUTO_DIGEST_STATE, 'utf-8').trim() === contentHash(text);
  } catch {
    return false;
  }
}

function recordOpened(text) {
  try {
    mkdirSync(dirname(AUTO_DIGEST_STATE), { recursive: true });
    writeFileSync(AUTO_DIGEST_STATE, contentHash(text));
  } catch {}
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
      // Default: the proven full-browser flow. The mini app window is opt-in via --mini
      // only — it's BROKEN/UNPROVEN (windows ended up on unreachable virtual desktops).
      if (!values.mini || !openMiniWindowWSL(dosPath)) {
        execSync(`powershell.exe -Command "Start-Process '${dosPath}'"`, { stdio: 'ignore' });
      }
    } else if (plat === 'darwin') {
      execSync(`open "file://${filePath}"`);
    } else if (plat === 'win32') {
      execSync(`start "" "file://${filePath}"`);
    } else {
      const exe = ['google-chrome', 'chromium', 'chromium-browser'].find(b => { try { execSync(`command -v ${b}`, { stdio: 'ignore' }); return true; } catch { return false; } });
      if (exe && values.mini) {
        spawn(exe, [`--app=file://${filePath}`, `--window-size=${MINI_W},${MINI_H}`], { detached: true, stdio: 'ignore' }).unref();
      } else {
        execSync(`xdg-open "file://${filePath}" 2>/dev/null || sensible-browser "file://${filePath}" 2>/dev/null`);
      }
    }
  } catch {
    console.error(`Could not open browser. Open manually: ${filePath}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
