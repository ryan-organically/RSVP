#!/usr/bin/env node
// Focal MCP server — gives any agent, on any MCP host, somewhere to put long output.
//
// Agents produce more prose than anything else on a developer's machine and then dump
// it into a terminal scrollback nobody reads. This server hands that text to a reader
// instead: the agent calls focal_open, gets back a link, and the human reads it at
// whatever speed they like.
//
// Zero dependencies, stdio transport, JSON-RPC 2.0 line-delimited. Runs on the user's
// own machine. It stores nothing and sends nothing anywhere: focal_open builds a URL
// whose fragment carries the text, and browsers never transmit a fragment to a server,
// so the text goes from this process to that browser tab and stops there.
import { deflateRawSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const ORIGIN = (process.env.FOCAL_ORIGIN || 'https://focal.wiki').replace(/\/+$/, '');
const KNOWN_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Fragments are generous but not unlimited, and a multi-megabyte URL is a bad idea
// regardless. Matches the limit in public/embed.js.
const FRAGMENT_LIMIT = 180000;

// ---- helpers ---------------------------------------------------------------
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function focalUrl(text, { title, wpm } = {}) {
  const packed = b64url(deflateRawSync(Buffer.from(text, 'utf8'), { level: 9 }));
  if (packed.length > FRAGMENT_LIMIT) {
    const err = new Error(
      `text is too long to hand over in a link (${text.length.toLocaleString()} characters). ` +
      `Split it, or pass a public URL to focal_read_url instead.`);
    err.tooLong = true;
    throw err;
  }
  let url = `${ORIGIN}/#t=${packed}`;
  if (title) url += `&ti=${encodeURIComponent(String(title).slice(0, 200))}`;
  const n = parseInt(wpm, 10);
  if (n >= 50 && n <= 1200) url += `&wpm=${n}`;
  return url;
}

// Best-effort browser open. Never throws, never blocks, never writes to stdout —
// stdout is the protocol channel and a stray byte there corrupts the session.
function openUrl(url) {
  const isWsl = existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ||
                /microsoft/i.test(process.env.WSL_DISTRO_NAME || '');
  let cmd, args;
  if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else if (process.platform === 'win32') { cmd = 'cmd.exe'; args = ['/c', 'start', '', url]; }
  else if (isWsl) {
    const win = ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
                 '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
      .find(p => existsSync(p));
    if (win) { cmd = win; args = [url]; } else { cmd = 'wslview'; args = [url]; }
  } else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

// ---- tools -----------------------------------------------------------------
const TOOLS = [
  {
    name: 'focal_open',
    description:
      'Hand a block of text to the Focal speed reader and get back a link the user can ' +
      'open. Use this for anything long you have written or found — a summary, an ' +
      'analysis, a design doc, a research digest, a chapter — instead of dumping it into ' +
      'the chat where it will be scrolled past. The text rides the URL fragment, so it ' +
      'never reaches any server. Returns the link, and opens it in the browser by default.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to read. Plain text or markdown.' },
        title: { type: 'string', description: 'Title shown in the reader library.' },
        wpm: { type: 'number', description: 'Starting words per minute (50-1200).' },
        open: { type: 'boolean', description: 'Open in the browser (default true).' },
      },
      required: ['text'],
    },
  },
  {
    name: 'focal_read_url',
    description:
      'Fetch a public document (arXiv or bioRxiv or medRxiv paper, Wikipedia article, ' +
      'PubMed Central, Project Gutenberg or Standard Ebooks book) and return its readable ' +
      'text, stripped of navigation and page furniture. By default returns only metadata ' +
      'plus a Focal link, which is what you want when the point is for the HUMAN to read ' +
      'it; set include_text if you need the prose in your own context.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'https URL of the document.' },
        include_text: { type: 'boolean', description: 'Return the text itself (default false).' },
        max_chars: { type: 'number', description: 'Cap on returned text when include_text is set (default 20000).' },
        open: { type: 'boolean', description: 'Open it in the reader too (default false).' },
      },
      required: ['url'],
    },
  },
];

async function callTool(name, args) {
  args = args || {};

  if (name === 'focal_open') {
    const text = String(args.text || '');
    if (text.trim().length < 1) throw new Error('text is empty');
    const url = focalUrl(text, { title: args.title, wpm: args.wpm });
    const opened = args.open === false ? false : openUrl(url);
    const words = (text.match(/\S+/g) || []).length;
    return `${opened ? 'Opened in Focal' : 'Ready to read in Focal'} — ${words.toLocaleString()} words` +
           `${args.title ? ` — "${args.title}"` : ''}\n${url}`;
  }

  if (name === 'focal_read_url') {
    const target = String(args.url || '');
    if (!/^https:\/\//i.test(target)) throw new Error('url must be an https URL');
    const r = await fetch(`${ORIGIN}/api/read?url=${encodeURIComponent(target)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `could not read that URL (HTTP ${r.status})`);

    let link = '';
    try { link = focalUrl(data.text, { title: data.title }); } catch { link = ''; }
    if (args.open === true && link) openUrl(link);

    const head = [
      data.title ? `Title: ${data.title}` : null,
      data.byline ? `By: ${data.byline}` : null,
      `Source: ${data.source} — ${Number(data.words).toLocaleString()} words`,
      link ? `Read in Focal: ${link}` : `(too long to hand over as a link)`,
    ].filter(Boolean).join('\n');

    if (!args.include_text) return head;
    const cap = Math.max(500, Math.min(500000, parseInt(args.max_chars, 10) || 20000));
    const body = data.text.length > cap
      ? data.text.slice(0, cap) + `\n\n[truncated at ${cap.toLocaleString()} of ${data.text.length.toLocaleString()} characters]`
      : data.text;
    return `${head}\n\n---\n\n${body}`;
  }

  throw new Error(`unknown tool: ${name}`);
}

// ---- JSON-RPC over stdio ---------------------------------------------------
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const result = (id, r) => send({ jsonrpc: '2.0', id, result: r });
const failure = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize': {
      const asked = params && params.protocolVersion;
      return result(id, {
        protocolVersion: KNOWN_PROTOCOLS.includes(asked) ? asked : KNOWN_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'focal', version: VERSION },
        instructions:
          'Focal turns long text into a fast, focused read. When you produce something ' +
          'long enough that a human would skim it, call focal_open instead of printing it.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;                                     // notifications: no reply
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      try {
        const text = await callTool(name, params && params.arguments);
        return result(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        // Tool failures are results, not protocol errors — the agent should see and
        // recover from them rather than the session breaking.
        return result(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    case 'resources/list':
      return result(id, { resources: [] });
    case 'prompts/list':
      return result(id, { prompts: [] });
    default:
      if (isRequest) return failure(id, -32601, `method not found: ${method}`);
  }
}

function serve() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', line => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try { msg = JSON.parse(s); }
    catch { return failure(null, -32700, 'parse error'); }
    Promise.resolve(handle(msg)).catch(e => {
      if (msg && msg.id !== undefined && msg.id !== null) failure(msg.id, -32603, String(e.message || e));
    });
  });
  rl.on('close', () => process.exit(0));
}

// Only take over stdin when run as a program. Importing this module (tests, or anything
// reusing focalUrl) must not start a server, claim the parent's stdin, or exit its process.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) serve();

export { focalUrl, callTool, TOOLS, serve };
