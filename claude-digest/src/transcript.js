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
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
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
