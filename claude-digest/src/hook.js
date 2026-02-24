import { parseTranscript } from './transcript.js';
import { generateDigest } from './digest.js';
import { formatJSON } from './formats/json.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Hook mode: reads Claude Code hook JSON from stdin,
 * generates a digest, and writes it to ~/.claude/digests/.
 */
export async function runHook(options = {}) {
  const input = await readStdin();
  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    console.error('claude-digest: invalid hook input');
    process.exit(1);
  }

  const transcriptPath = hookData.transcript_path;
  const sessionId = hookData.session_id || 'unknown';
  const cwd = hookData.cwd || '';

  if (!transcriptPath) {
    console.error('claude-digest: no transcript_path in hook input');
    process.exit(1);
  }

  const { text, meta } = await parseTranscript(transcriptPath);
  if (!text.trim()) {
    process.exit(0); // empty session, nothing to digest
  }

  const digest = await generateDigest(text, { model: options.model, cwd });
  const json = formatJSON(digest, meta);

  // Write to ~/.claude/digests/
  const digestDir = join(homedir(), '.claude', 'digests');
  await mkdir(digestDir, { recursive: true });
  const outPath = join(digestDir, `${sessionId}.json`);
  await writeFile(outPath, json, 'utf-8');

  // Output for Claude Code hook system
  console.log(JSON.stringify({ systemMessage: `Session digest saved to ${outPath}` }));
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}
