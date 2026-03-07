#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { writeFile, readFileSync, copyFileSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { findCurrentTranscript, parseTranscriptChunks } from '../src/transcript.js';
import { formatRSVP } from '../src/formats/rsvp.js';
import { formatJSON } from '../src/formats/json.js';
import { formatMarkdown } from '../src/formats/markdown.js';
import { formatHTML } from '../src/formats/html.js';

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    parse:   { type: 'boolean', default: false },
    inject:  { type: 'boolean', default: false },
    open:    { type: 'boolean', default: false },
    format:  { type: 'string', short: 'f', default: 'json' },
    output:  { type: 'string', short: 'o' },
    help:    { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`claude-digest - Fast Dev Digest from Claude Code sessions

Usage:
  claude-digest --parse                  Parse current session → JSON chunks to stdout
  echo '<json>' | claude-digest --inject --open   Format digest and open in RSVP Reader

Options:
  --parse               Parse transcript, output chunks as JSON
  --inject              Read digest JSON from stdin, format it
  --open                Open formatted output in browser
  -f, --format <type>   json | markdown | html | rsvp (default: json)
  -o, --output <path>   Write to file instead of stdout
  -h, --help            Show this help`);
  process.exit(0);
}

async function main() {
  if (values.parse) {
    // Parse mode: find transcript, output chunks as JSON
    const transcriptPath = await findCurrentTranscript();
    if (!transcriptPath) { console.error('No session transcript found.'); process.exit(1); }
    const { chunks, meta } = await parseTranscriptChunks(transcriptPath);
    if (!chunks.length) { console.error('Empty session.'); process.exit(1); }
    let repoRoot;
    try { repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim(); } catch { repoRoot = process.cwd(); }
    console.log(JSON.stringify({ project: basename(repoRoot), chunks, meta }));
    return;
  }

  if (values.inject) {
    const input = await readStdin();
    const digest = JSON.parse(input);
    const meta = { timestamp: new Date().toISOString() };
    const fmt = values.open ? 'rsvp' : values.format;

    let output;
    switch (fmt) {
      case 'markdown': case 'md': output = formatMarkdown(digest, meta); break;
      case 'html': output = formatHTML(digest, meta); break;
      case 'rsvp': output = await formatRSVP(digest, meta); break;
      case 'json': default: output = formatJSON(digest, meta); break;
    }

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
