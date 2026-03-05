#!/usr/bin/env node

/**
 * rsvp-pipe — Pipes text into a self-contained RSVP reader HTML and opens it.
 *
 * Reads hook JSON from stdin (or raw text with --raw).
 * Strips markdown noise, auto-tags blocks, generates a standalone HTML file,
 * and opens it in the browser. No server needed.
 *
 * ENV:
 *   RSVP_MIN_WORDS   – minimum word count to trigger (default 150)
 *   RSVP_NO_OPEN     – set to "1" to skip opening the browser
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIN_WORDS = parseInt(process.env.RSVP_MIN_WORDS || '150', 10);
const NO_OPEN = process.env.RSVP_NO_OPEN === '1';

// ── Read stdin ──────────────────────────────────────────────
let message, cwd, agentType;
try {
  const raw = readFileSync('/dev/stdin', 'utf-8');
  try {
    const input = JSON.parse(raw);
    message = input.last_assistant_message || '';
    cwd = input.cwd || '';
    agentType = input.agent_type || '';
  } catch {
    // Raw text mode
    message = raw;
    cwd = process.cwd();
    agentType = '';
  }
} catch {
  process.exit(0);
}

if (!message || typeof message !== 'string') process.exit(0);

// ── Word count gate ─────────────────────────────────────────
const words = message.split(/\s+/).filter(w => /\w/.test(w));
if (words.length < MIN_WORDS) process.exit(0);

// ── Auto-tag ────────────────────────────────────────────────
const lower = message.toLowerCase();

function detectTag(text) {
  const t = text.toLowerCase();
  if (/\b(bug|error|breaking|security|vulnerab|crash|fail)/i.test(t)) return 'critical';
  if (/\b(warn|careful|caution|important|concern|regress)/i.test(t)) return 'high';
  if (/\b(created|completed|finished|committed|implemented|fixed|added|built)/i.test(t)) return 'done';
  if (/\b(decide|choice|option|should we|trade.?off|alternativ)/i.test(t)) return 'decision';
  return 'info';
}

function detectSessionTag() {
  if (agentType === 'Plan' || /\b(plan|approach|strategy|step\s*[0-9]|implementation)/i.test(lower)) return 'plan';
  if (agentType === 'Explore' || /\b(found|architecture|codebase|explor|analys)/i.test(lower)) return 'analysis';
  if (/\b(review|PR|diff|changes look|code review)/i.test(lower)) return 'review';
  if (/\b(summary|overview|recap|conclusion)/i.test(lower)) return 'summary';
  return 'info';
}

const sessionTag = detectSessionTag();

// ── Extract title ───────────────────────────────────────────
function extractTitle(text) {
  const headerMatch = text.match(/^#+\s+(.+)/m);
  if (headerMatch) return headerMatch[1].replace(/\*\*/g, '').slice(0, 80);
  const sentenceMatch = text.match(/^(.+?[.!?])\s/);
  if (sentenceMatch && sentenceMatch[1].length < 100) return sentenceMatch[1];
  return `Claude ${sessionTag} — ${new Date().toLocaleString()}`;
}

// ── Strip non-paragraph markdown ────────────────────────────
function stripMarkdownNoise(text) {
  return text
    .replace(/^\|.*\|$/gm, '')
    .replace(/^\s*[-|:]+\s*$/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Split into blocks ───────────────────────────────────────
function splitIntoBlocks(rawText) {
  const text = stripMarkdownNoise(rawText);
  const blocks = [];
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  for (const para of paragraphs) {
    const pText = para.replace(/\n/g, ' ').trim();
    if (pText.split(/\s+/).length < 5) continue;
    blocks.push({ tag: detectTag(pText), text: pText });
  }
  if (blocks.length === 0) {
    blocks.push({ tag: 'info', text: text.replace(/\n/g, ' ').trim() });
  }
  return blocks;
}

// ── Build digest ────────────────────────────────────────────
const title = extractTitle(message);
const blocks = splitIntoBlocks(message);
const projectName = cwd ? cwd.split('/').pop() : 'Unknown';

const session = {
  id: `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  title,
  project: projectName,
  time: new Date().toISOString(),
  blocks,
};

// ── Read the RSVP reader HTML and inject digest ─────────────
const readerPath = join(__dirname, '..', '..', 'public', 'index.html');
let html;
try {
  html = readFileSync(readerPath, 'utf-8');
} catch {
  console.error(`Cannot find RSVP reader at ${readerPath}`);
  process.exit(1);
}

const injection = `
<script>
(function() {
  var d = ${JSON.stringify(session)};
  // Wait for everything to be ready, then inject and open
  window.addEventListener('load', function() {
    setTimeout(function() {
      DIGEST_SESSIONS.unshift(d);
      switchTab('digest');
      renderDigestList();
      setTimeout(function() { openDigest(d.id); }, 200);
    }, 300);
  });
})();
</script>`;

html = html.replace('</body>', injection + '\n</body>');

// ── Write temp HTML and open ────────────────────────────────
const isWSL = (() => {
  try { return readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft'); } catch { return false; }
})();

let outPath;
if (isWSL) {
  // Write to Windows temp so browsers can access it
  const winUser = execSync('cmd.exe /c "echo %USERPROFILE%"', { encoding: 'utf-8' }).trim().replace(/\r/g, '');
  const winTemp = winUser + '\\AppData\\Local\\Temp';
  const fname = `rsvp-pipe-${Date.now()}.html`;
  const wslTemp = execSync(`wslpath "${winTemp}"`, { encoding: 'utf-8' }).trim();
  outPath = join(wslTemp, fname);
  writeFileSync(outPath, html, 'utf-8');
  if (!NO_OPEN) {
    const winPath = `${winTemp}\\${fname}`;
    try {
      execSync(`cmd.exe /c start "" "${winPath}"`, { stdio: 'ignore' });
    } catch {}
  }
} else {
  outPath = join(tmpdir(), `rsvp-pipe-${Date.now()}.html`);
  writeFileSync(outPath, html, 'utf-8');
  if (!NO_OPEN) {
    try {
      const plat = platform();
      if (plat === 'darwin') execSync(`open "file://${outPath}"`);
      else if (plat === 'win32') execSync(`start "" "file://${outPath}"`);
      else execSync(`xdg-open "file://${outPath}" 2>/dev/null || sensible-browser "file://${outPath}" 2>/dev/null`);
    } catch {}
  }
}

console.error(`RSVP: ${outPath}`);
process.exit(0);
