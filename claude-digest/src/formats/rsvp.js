import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Search paths for the RSVP reader HTML
const READER_SEARCH_PATHS = [
  join(__dirname, '..', '..', '..', 'rsvp-reader (2).html'),  // sibling to claude-digest/
  join(__dirname, '..', '..', 'rsvp-reader (2).html'),         // inside claude-digest/
  join(__dirname, '..', '..', 'rsvp-reader.html'),
];

async function findReader() {
  for (const p of READER_SEARCH_PATHS) {
    try { await access(p); return p; } catch {}
  }
  return null;
}

/**
 * Generate a full RSVP reader HTML with a digest pre-injected.
 * Opens directly to the digest tab and auto-starts playback.
 */
export async function formatRSVP(digest, meta = {}) {
  const readerPath = await findReader();
  if (!readerPath) {
    throw new Error('Could not find rsvp-reader HTML. Expected next to claude-digest/ directory.');
  }
  let html = await readFile(readerPath, 'utf-8');

  const session = {
    id: slugify(digest.title) + '-' + Date.now().toString(36),
    title: digest.title,
    project: digest.project || '',
    time: meta.timestamp || new Date().toISOString(),
    blocks: digest.blocks,
  };

  // Inject the digest session into DIGEST_SESSIONS and auto-open it
  const autoOpenScript = `
<script>
// Injected by claude-digest CLI
(function() {
  const _injectedDigest = ${JSON.stringify(session)};

  // Wait for DIGEST_SESSIONS to exist, then prepend
  const _waitForReady = setInterval(() => {
    if (typeof DIGEST_SESSIONS !== 'undefined' && typeof switchTab === 'function') {
      clearInterval(_waitForReady);
      DIGEST_SESSIONS.unshift(_injectedDigest);
      // Switch to digest tab and auto-open
      switchTab('digest');
      setTimeout(() => openDigest(_injectedDigest.id), 100);
    }
  }, 50);
})();
</script>`;

  // Insert before closing </body>
  html = html.replace('</body>', autoOpenScript + '\n</body>');

  return html;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}
