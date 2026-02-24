import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a session summarizer for Claude Code development sessions. Given a transcript of a Claude Code session, produce a structured digest with tagged blocks.

Each block must be ONE concise sentence (15-30 words) summarizing a key finding, action, or decision. Write for speed-reading — every word must earn its place.

Tags:
- critical: Bugs found, breaking issues, security problems, data loss risks
- high: Important warnings, performance issues, significant concerns, regressions
- done: Tasks completed, features implemented, fixes applied, files created
- info: Architecture notes, context, technical observations, patterns discovered
- decision: Decisions made or decisions the user needs to make

Rules:
- Use specific numbers, file names, function names, and concrete details
- Each block must stand alone — readable without context
- Order blocks: critical first, then high, done, info, decision
- Aim for 8-20 blocks total depending on session length
- Generate a short title (4-8 words) describing the session's main focus
- Identify the project name from the working directory path
- Do NOT use markdown formatting in block text — plain text only

Return ONLY valid JSON (no code fences):
{ "title": "...", "project": "...", "blocks": [{ "tag": "...", "text": "..." }] }`;

/**
 * Generate a digest from parsed transcript text.
 * @param {string} transcriptText - Condensed transcript from parseTranscript
 * @param {object} options
 * @param {string} [options.model] - Claude model ID
 * @param {string} [options.cwd] - Working directory for project name inference
 * @returns {Promise<{title: string, project: string, blocks: Array<{tag: string, text: string}>}>}
 */
export async function generateDigest(transcriptText, options = {}) {
  const model = options.model || 'claude-sonnet-4-20250514';
  const client = new Anthropic();

  const userMessage = options.cwd
    ? `Working directory: ${options.cwd}\n\n${transcriptText}`
    : transcriptText;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Parse JSON from response, handling potential code fences
  const jsonStr = text.replace(/^```json?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const digest = JSON.parse(jsonStr);

  // Validate structure
  if (!digest.title || !Array.isArray(digest.blocks)) {
    throw new Error('Invalid digest response: missing title or blocks');
  }

  const validTags = new Set(['critical', 'high', 'done', 'info', 'decision']);
  digest.blocks = digest.blocks.filter(b => validTags.has(b.tag) && typeof b.text === 'string');

  return digest;
}
