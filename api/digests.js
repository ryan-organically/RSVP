let kv = null;
try {
  kv = require('@vercel/kv').kv;
} catch {}

const KV_KEY = 'digests';
const MAX_DIGESTS = 50;

const FALLBACK_DIGESTS = [
  {
    id: 'icr-audit',
    title: 'ICR Site — Full Audit',
    project: 'Integrated Contracting',
    time: '2026-02-23T00:15:00',
    blocks: [
      { tag:'critical', text:'Kitchen page has unclosed <section> tag — gallery section bleeds into testimonials, breaking page layout' },
      { tag:'critical', text:'7 !important declarations in CSS violating project rules. 13 usages of corrupted CSS variable name --metal with deleted characters' },
      { tag:'critical', text:'All 10 service pages use layout null with hardcoded HTML. The service.html layout exists and includes banner, but no page uses it' },
      { tag:'high', text:'CSS architecture scores 4 out of 10. 6,259 lines across 2 files. 500 to 700 redundant lines from duplicate section and hero-section patterns' },
      { tag:'high', text:'7 inconsistent breakpoints: 991, 976, 768, 767, 600, 480, 479px. 40+ inline style instances in HTML. 75 dead display-none rules' },
      { tag:'high', text:'Basement, Fireplaces, and Windows-Doors pages are missing ticker sections AND location bubbles entirely. Bathroom has 4 ticker tracks instead of 3' },
      { tag:'high', text:'og:url meta tags missing on 16+ pages. Canonical URLs missing on all 10 service pages. robots.txt has wrong domain for sitemap URL' },
      { tag:'info', text:'FAQPage schema missing from FAQ page — huge structured data opportunity. Service schema missing from all 10 service pages' },
      { tag:'info', text:'LocalBusiness schema has empty phone field. 4 blog posts not in sitemap.xml. Blog article schema missing from all posts' },
      { tag:'info', text:'Announcement banner present on 13 pages but missing from ALL 10 service pages and 5 other pages. No dedicated announcement landing page exists' },
      { tag:'done', text:'Kitchen unclosed section tag fixed. All 7 !important declarations removed with proper specificity. Corrupted CSS variable name fixed' },
      { tag:'done', text:'Banner include added to all 10 service pages. Banner.html updated with link to new announcement page' },
      { tag:'done', text:'Created announcement landing page at /announcements/south-hills-home-show with full layout, meta tags, and event details' },
      { tag:'decision', text:'Decision needed: Should Basement, Fireplaces, and Windows-Doors get ticker sections and location bubbles to match other 7 service pages?' },
      { tag:'decision', text:'Decision needed: Migrate all service pages from layout null to service.html layout? Big refactor but eliminates all hardcoded duplication' },
    ]
  },
  {
    id: 'malleable-voice-tools',
    title: 'Malleable — Voice Native Tools',
    project: 'Malleable Calendar',
    time: '2026-02-23T01:30:00',
    blocks: [
      { tag:'done', text:'4 files created or modified. server/voice-tools.ts at 600 lines with 27 tool definitions in Anthropic Tool format' },
      { tag:'done', text:'27 tools built: mutation tools for create, update, delete across tasks, events, notes, projects, buckets, goals, and timers' },
      { tag:'done', text:'Availability tools: check_availability with overlap detection, find_available_slots with gap computation, check_free_busy for point-in-time queries, summarize_day, and list_events' },
      { tag:'done', text:'Query tools: search_tasks, search_notes, list_projects, list_buckets, get_time_summary. All wired to execution dispatcher' },
      { tag:'done', text:'Claude Code integration: spawn_claude_code with confirmation flow for edits. Persistent sessions per bucket with resume for context continuity across voice turns' },
      { tag:'info', text:'Claude Code defaults to read-only: Glob, Grep, Read. Edit mode adds Edit, Write, Bash. Uses Sonnet model for coding intelligence' },
      { tag:'done', text:'server/voice-claude-code.ts at 150 lines. Voice-optimized system prompt — 1 to 2 sentences, no markdown. Intent detection for search, read, edit, navigate, explain' },
      { tag:'done', text:'Added repo_path TEXT column to event_buckets via Supabase migration. Connects buckets to codebases for Claude Code sessions' },
      { tag:'done', text:'voice-server.ts updated with VOICE_NATIVE_TOOLS flag. llmWithTools calls Anthropic API with tools array, parses tool_use content blocks' },
      { tag:'done', text:'processTranscriptWithTools runs multi-iteration execution loop, max 5 rounds. Builds tool_result messages, sends progress status updates via WebSocket' },
      { tag:'info', text:'Architecture flow: Voice Input to STT to processTranscriptWithTools. Model calls tools iteratively, each tool_use triggers executeVoiceTool, returns tool_result, loops until end_turn produces final text sent to TTS' },
      { tag:'info', text:'Multi-step example: Schedule meeting tomorrow at 2. Model calls check_availability, finds conflict. Calls find_available_slots, finds 3pm free. Suggests alternative. User confirms, model calls create_event. Done.' },
      { tag:'done', text:'Generic handleDeleteConfirmable pattern implemented. Fetches item name, returns needs_confirmation flag, waits for confirmed true on re-call. Prevents accidental deletes via voice' },
    ]
  }
];

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleGet(req, res) {
  if (!kv) return res.status(200).json(FALLBACK_DIGESTS);
  try {
    const digests = await kv.get(KV_KEY);
    if (!digests || !Array.isArray(digests) || digests.length === 0) {
      return res.status(200).json(FALLBACK_DIGESTS);
    }
    return res.status(200).json(digests);
  } catch (err) {
    console.error('KV read error, returning fallback:', err.message);
    return res.status(200).json(FALLBACK_DIGESTS);
  }
}

async function handlePost(req, res) {
  // Validate the incoming digest session
  const digest = req.body;

  if (!digest || typeof digest !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  if (!digest.id || typeof digest.id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "id" (string required)' });
  }

  if (!digest.title || typeof digest.title !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "title" (string required)' });
  }

  if (!Array.isArray(digest.blocks)) {
    return res.status(400).json({ error: 'Missing or invalid "blocks" (array required)' });
  }

  try {
    // Read existing digests from KV
    let existing = [];
    if (!kv) {
      return res.status(503).json({ error: 'Storage not configured. Add Vercel KV to this project.' });
    }
    try {
      const stored = await kv.get(KV_KEY);
      if (Array.isArray(stored)) {
        existing = stored;
      }
    } catch (readErr) {
      console.error('KV read error:', readErr.message);
    }

    // Prepend new digest, cap at MAX_DIGESTS
    const updated = [digest, ...existing].slice(0, MAX_DIGESTS);

    await kv.set(KV_KEY, updated);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('KV write error:', err.message);
    return res.status(500).json({ error: 'Failed to save digest' });
  }
}
