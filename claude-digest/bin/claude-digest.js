#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { writeFile, stat, readdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir, tmpdir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { parseTranscript } from '../src/transcript.js';
import { generateDigest } from '../src/digest.js';
import { formatJSON } from '../src/formats/json.js';
import { formatMarkdown } from '../src/formats/markdown.js';
import { formatHTML } from '../src/formats/html.js';
import { formatRSVP } from '../src/formats/rsvp.js';
import { runHook } from '../src/hook.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    format:  { type: 'string', short: 'f', default: 'json' },
    output:  { type: 'string', short: 'o' },
    hook:    { type: 'boolean', default: false },
    latest:  { type: 'boolean', default: false },
    project: { type: 'string' },
    model:   { type: 'string' },
    open:    { type: 'boolean', default: false },
    help:    { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`claude-digest - Generate RSVP Dev Digest from Claude Code sessions

Usage:
  claude-digest <transcript.jsonl>              Output JSON digest to stdout
  claude-digest <file> -f markdown              Output as Markdown
  claude-digest <file> -f html -o digest.html   Write HTML to file
  claude-digest --latest                        Use most recent transcript
  claude-digest --latest --project <name>       Latest for a project
  claude-digest --latest --open                  Generate and open RSVP reader
  claude-digest --hook                          Hook mode (reads stdin)

Options:
  -f, --format <type>   json | markdown | html | rsvp (default: json)
  -o, --output <path>   Write to file instead of stdout
  --open                Generate RSVP reader and open in browser
  --latest              Find most recent transcript in ~/.claude/projects/
  --project <name>      Filter --latest to project directory containing <name>
  --model <id>          Claude model (default: claude-sonnet-4-20250514)
  --hook                Hook mode: read Claude Code hook JSON from stdin
  -h, --help            Show this help

Environment:
  ANTHROPIC_API_KEY     Required. Your Anthropic API key.`);
  process.exit(0);
}

async function main() {
  // Hook mode
  if (values.hook) {
    await runHook({ model: values.model });
    return;
  }

  // Resolve transcript path
  let filePath = positionals[0];

  if (values.latest) {
    filePath = await findLatestTranscript(values.project);
    if (!filePath) {
      console.error('No transcript found.');
      process.exit(1);
    }
    console.error(`Using: ${filePath}`);
  }

  if (!filePath) {
    console.error('Usage: claude-digest <transcript.jsonl> [options]');
    console.error('       claude-digest --latest [options]');
    console.error('Run with --help for more info.');
    process.exit(1);
  }

  // Parse transcript
  const { text, meta } = await parseTranscript(filePath);
  if (!text.trim()) {
    console.error('Transcript is empty or has no parseable content.');
    process.exit(1);
  }

  console.error(`Parsed ${text.length} chars from transcript. Generating digest...`);

  // Generate digest
  const digest = await generateDigest(text, { model: values.model, cwd: meta.cwd });

  // --open implies rsvp format
  const fmt = values.open ? 'rsvp' : values.format;

  // Format output
  let output;
  switch (fmt) {
    case 'markdown': case 'md':
      output = formatMarkdown(digest, meta);
      break;
    case 'html':
      output = formatHTML(digest, meta);
      break;
    case 'rsvp':
      output = await formatRSVP(digest, meta);
      break;
    case 'json':
    default:
      output = formatJSON(digest, meta);
      break;
  }

  // --open: write to temp file and launch browser
  if (values.open) {
    const tmpPath = join(tmpdir(), `claude-digest-${Date.now()}.html`);
    await writeFile(tmpPath, output, 'utf-8');
    openBrowser(tmpPath);
    console.error(`Opened RSVP reader: ${tmpPath}`);
    return;
  }

  // Write or print
  if (values.output) {
    await writeFile(values.output, output, 'utf-8');
    console.error(`Written to ${values.output}`);
  } else {
    console.log(output);
  }
}

async function findLatestTranscript(projectFilter) {
  const projectsDir = join(homedir(), '.claude', 'projects');
  let dirs;
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return null;
  }

  if (projectFilter) {
    dirs = dirs.filter(d => d.toLowerCase().includes(projectFilter.toLowerCase()));
  }

  let latest = null;
  let latestTime = 0;

  for (const dir of dirs) {
    const dirPath = join(projectsDir, dir);
    let files;
    try {
      files = await readdir(dirPath);
    } catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const fp = join(dirPath, file);
      try {
        const s = await stat(fp);
        if (s.mtimeMs > latestTime) {
          latestTime = s.mtimeMs;
          latest = fp;
        }
      } catch { continue; }
    }
  }

  return latest;
}

function openBrowser(filePath) {
  const url = `file://${filePath}`;
  const plat = platform();
  try {
    if (plat === 'darwin') execSync(`open "${url}"`);
    else if (plat === 'win32') execSync(`start "" "${url}"`);
    else execSync(`xdg-open "${url}" 2>/dev/null || wslview "${url}" 2>/dev/null || sensible-browser "${url}"`);
  } catch {
    console.error(`Could not open browser. Open manually: ${filePath}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
