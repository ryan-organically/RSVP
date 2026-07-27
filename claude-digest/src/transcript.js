import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const MAX_CHARS = 120_000;

/**
 * Find the current session's transcript by matching the git repo root
 * to the project directory naming convention in ~/.claude/projects/.
 */
export async function findCurrentTranscript() {
  let repoRoot;
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    repoRoot = process.cwd();
  }

  const projectKey = repoRoot.replace(/\//g, '-');
  const projectDir = join(homedir(), '.claude', 'projects', projectKey);

  let files;
  try {
    files = await readdir(projectDir);
  } catch {
    return null;
  }

  // Find the most recently modified .jsonl
  let latest = null;
  let latestTime = 0;
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const fp = join(projectDir, f);
    try {
      const s = await stat(fp);
      if (s.mtimeMs > latestTime) {
        latestTime = s.mtimeMs;
        latest = fp;
      }
    } catch { continue; }
  }

  return latest;
}

/**
 * Parse a .jsonl transcript into condensed text chunks for parallel summarization.
 * Returns 2-3 chunks of roughly equal size.
 */
export async function parseTranscriptChunks(filePath, numChunks = 2) {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  const parts = [];
  let totalChars = 0;
  let meta = { cwd: '', timestamp: '' };

  for await (const line of rl) {
    if (totalChars >= MAX_CHARS) break;

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'user' && entry.cwd && !meta.cwd) {
      meta.cwd = entry.cwd;
      meta.timestamp = entry.timestamp || '';
    }

    if (['progress', 'file-history-snapshot', 'queue-operation', 'system'].includes(entry.type)) continue;

    const msg = entry.message;
    if (!msg) continue;

    if (entry.type === 'user' && msg.role === 'user') {
      const text = extractText(msg.content);
      if (text) { const c = `[USER] ${text}\n`; parts.push(c); totalChars += c.length; }
    }

    if (entry.type === 'assistant' && msg.role === 'assistant') {
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (totalChars >= MAX_CHARS) break;
        if (block.type === 'text' && block.text?.trim()) {
          const c = `[ASST] ${block.text.trim().slice(0, 500)}\n`;
          parts.push(c); totalChars += c.length;
        }
        if (block.type === 'tool_use') {
          const s = summarizeTool(block);
          if (s) { const c = `[TOOL] ${s}\n`; parts.push(c); totalChars += c.length; }
        }
      }
    }
  }

  // Split into roughly equal chunks
  const chunkSize = Math.ceil(parts.length / numChunks);
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    chunks.push(parts.slice(i * chunkSize, (i + 1) * chunkSize).join(''));
  }

  return { chunks: chunks.filter(c => c.trim()), meta };
}

/**
 * Read the FULL text of the most recent SUBSTANTIVE assistant response
 * (verbatim, uncapped). Used to mirror the latest answer into RSVP for
 * reading — no summarization. Tool-call-only turns (no text block) are
 * skipped, and short acknowledgments ("Digest opened.", one-line status
 * confirmations) are skipped too: RSVP exists for reading mass amounts of
 * text, so the obvious long response wins over terminal feedback. Responses
 * shorter than minChars are passed over while walking backwards; if nothing
 * qualifies, the old behavior (answer before the last user turn, else the
 * latest answer) is the fallback.
 */
export async function parseLastResponse(filePath, { minChars = 400, exact = false } = {}) {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let meta = { cwd: '', timestamp: '' };
  let pending = '';        // most recent assistant text seen so far
  let pendingTs = '';
  let beforeLastUser = ''; // assistant text that preceded the last REAL user message
  let beforeLastUserTs = '';
  const history = [];      // recent assistant responses, oldest → newest

  for await (const line of rl) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'user' && entry.cwd && !meta.cwd) meta.cwd = entry.cwd;

    // A real user turn (typed input, including a /command) carries actual text —
    // tool_result carriers don't. Snapshot the answer that preceded it.
    if (entry.type === 'user' && entry.message?.role === 'user' && extractText(entry.message.content)) {
      beforeLastUser = pending;
      beforeLastUserTs = pendingTs;
    }

    if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      const content = entry.message.content;
      if (!Array.isArray(content)) continue;
      const text = content
        .filter(b => b.type === 'text' && b.text?.trim())
        .map(b => b.text.trim())
        .join('\n\n');
      if (text) {
        pending = text;
        pendingTs = entry.timestamp || pendingTs;
        history.push({ text, ts: pendingTs });
        if (history.length > 50) history.shift();
      }
    }
  }

  // exact mode (auto-digest hook): the literal final assistant response, no
  // fall-back to earlier turns — the caller decides whether it's worth opening.
  if (exact) {
    meta.timestamp = pendingTs || meta.timestamp;
    return { text: pending, meta };
  }

  // Preference order: the answer the user just read (before invoking the
  // command) if it's substantive; otherwise the most recent response long
  // enough to be worth speed-reading; otherwise the old fallback.
  let text = '';
  let ts = '';
  if (beforeLastUser.length >= minChars) {
    text = beforeLastUser;
    ts = beforeLastUserTs;
  } else {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].text.length >= minChars) {
        text = history[i].text;
        ts = history[i].ts;
        break;
      }
    }
  }
  if (!text) {
    text = beforeLastUser || pending;
    ts = beforeLastUser ? beforeLastUserTs : pendingTs;
  }
  meta.timestamp = ts || meta.timestamp;
  return { text, meta };
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  return '';
}

function summarizeTool(block) {
  const name = block.name || 'Unknown';
  const input = block.input || {};
  switch (name) {
    case 'Read': return `Read ${input.file_path || 'file'}`;
    case 'Write': return `Write ${input.file_path || 'file'}`;
    case 'Edit': return `Edit ${input.file_path || 'file'}`;
    case 'Bash': return `Bash: ${(input.command || '').slice(0, 150)}`;
    case 'Glob': return `Glob: ${input.pattern || ''}`;
    case 'Grep': return `Grep: "${input.pattern || ''}"`;
    default: return `${name}`;
  }
}
