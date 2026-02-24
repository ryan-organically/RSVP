import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const MAX_CHARS = 150_000; // ~40k tokens rough estimate

/**
 * Parse a Claude Code .jsonl transcript into condensed text for summarization.
 * @param {string} filePath - Path to the .jsonl transcript
 * @returns {Promise<{text: string, meta: {sessionId: string, cwd: string, timestamp: string}}>}
 */
export async function parseTranscript(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  const parts = [];
  let totalChars = 0;
  let meta = { sessionId: '', cwd: '', timestamp: '' };

  for await (const line of rl) {
    if (totalChars >= MAX_CHARS) break;

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Extract session metadata from first user message
    if (entry.type === 'user' && entry.sessionId && !meta.sessionId) {
      meta.sessionId = entry.sessionId;
      meta.cwd = entry.cwd || '';
      meta.timestamp = entry.timestamp || '';
    }

    // Skip noise types
    if (['progress', 'file-history-snapshot', 'queue-operation', 'system'].includes(entry.type)) {
      continue;
    }

    const msg = entry.message;
    if (!msg) continue;

    if (entry.type === 'user' && msg.role === 'user') {
      const text = extractUserText(msg.content);
      if (text) {
        const chunk = `[USER] ${text}\n`;
        parts.push(chunk);
        totalChars += chunk.length;
      }
    }

    if (entry.type === 'assistant' && msg.role === 'assistant') {
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (totalChars >= MAX_CHARS) break;

        if (block.type === 'text' && block.text?.trim()) {
          const chunk = `[ASSISTANT] ${block.text.trim()}\n`;
          parts.push(chunk);
          totalChars += chunk.length;
        }

        if (block.type === 'tool_use') {
          const summary = summarizeToolUse(block);
          if (summary) {
            const chunk = `[TOOL] ${summary}\n`;
            parts.push(chunk);
            totalChars += chunk.length;
          }
        }
      }
    }
  }

  return { text: parts.join(''), meta };
}

function extractUserText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim();
  }
  return '';
}

function summarizeToolUse(block) {
  const name = block.name || 'Unknown';
  const input = block.input || {};

  switch (name) {
    case 'Read':
      return `Read ${input.file_path || 'file'}`;
    case 'Write':
      return `Write ${input.file_path || 'file'}`;
    case 'Edit':
      return `Edit ${input.file_path || 'file'}`;
    case 'Bash':
      return `Bash: ${(input.command || '').slice(0, 200)}`;
    case 'Glob':
      return `Glob: ${input.pattern || ''}`;
    case 'Grep':
      return `Grep: "${input.pattern || ''}" in ${input.path || 'cwd'}`;
    case 'Task':
      return `Task(${input.subagent_type || 'agent'}): ${(input.description || '').slice(0, 100)}`;
    case 'WebFetch':
      return `WebFetch: ${input.url || ''}`;
    case 'WebSearch':
      return `WebSearch: ${input.query || ''}`;
    default:
      return `${name}: ${JSON.stringify(input).slice(0, 150)}`;
  }
}
