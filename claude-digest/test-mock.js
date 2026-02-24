import { parseTranscript } from './src/transcript.js';
import { formatJSON } from './src/formats/json.js';
import { formatMarkdown } from './src/formats/markdown.js';
import { formatHTML } from './src/formats/html.js';
import { formatRSVP } from './src/formats/rsvp.js';
import { writeFile } from 'node:fs/promises';

// Test 1: Parse real transcript
const transcriptPath = process.argv[2] || '/home/ryan-organically/.claude/projects/-home-ryan-organically-dev-RSVP/e13aa8d2-a651-452c-b02b-93b9870c631f.jsonl';

console.log('=== PARSING TRANSCRIPT ===');
const { text, meta } = await parseTranscript(transcriptPath);
console.log(`Meta:`, meta);
console.log(`Text length: ${text.length} chars`);

const mockDigest = {
  title: 'RSVP Reader — Digest CLI Setup',
  project: 'RSVP',
  blocks: [
    { tag: 'done', text: 'Scaffolded claude-digest Node.js project with @anthropic-ai/sdk dependency and CLI bin entry' },
    { tag: 'done', text: 'Built transcript parser that extracts user messages, assistant text, and tool_use summaries from .jsonl files' },
    { tag: 'done', text: 'Implemented 3 output formatters: JSON (RSVP-compatible), Markdown with emoji tags, and self-contained HTML viewer' },
    { tag: 'done', text: 'Created Claude Code hook integration reading stdin JSON with transcript_path and writing to ~/.claude/digests/' },
    { tag: 'info', text: 'CLI supports --latest flag to auto-find most recent transcript across all projects in ~/.claude/projects/' },
    { tag: 'info', text: 'SKILL.md created for /digest slash command that invokes the CLI with user arguments' },
    { tag: 'decision', text: 'Requires ANTHROPIC_API_KEY environment variable for Claude API calls to generate tagged summary blocks' },
  ]
};

console.log('\n=== JSON ===');
console.log(formatJSON(mockDigest, meta));

console.log('\n=== MARKDOWN ===');
console.log(formatMarkdown(mockDigest, meta));

console.log('\n=== HTML ===');
const html = formatHTML(mockDigest, meta);
await writeFile('/home/ryan-organically/dev/RSVP/claude-digest/test-output.html', html);
console.log(`Written test-output.html (${html.length} bytes)`);

console.log('\n=== RSVP (full reader with injected digest) ===');
const rsvp = await formatRSVP(mockDigest, meta);
await writeFile('/home/ryan-organically/dev/RSVP/claude-digest/test-rsvp.html', rsvp);
console.log(`Written test-rsvp.html (${rsvp.length} bytes)`);
console.log('Open http://localhost:8080/claude-digest/test-rsvp.html to test');
