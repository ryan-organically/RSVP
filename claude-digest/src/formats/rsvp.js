import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Search paths for the RSVP reader HTML
const READER_SEARCH_PATHS = [
  join(__dirname, '..', '..', '..', 'public', 'index.html'),   // RSVP/public/index.html
  join(__dirname, '..', '..', '..', 'rsvp-reader (2).html'),   // legacy sibling
  join(__dirname, '..', '..', 'rsvp-reader (2).html'),
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

  // Inject the digest session: persist to localStorage, auto-open, fix back button
  const autoOpenScript = `
<script>
// Injected by claude-digest CLI
(function() {
  const _injectedDigest = ${JSON.stringify(session)};

  // Persist to localStorage so it survives across app opens
  try {
    const stored = JSON.parse(localStorage.getItem('localDigests') || '[]');
    if (!stored.some(s => s.id === _injectedDigest.id)) {
      stored.unshift(_injectedDigest);
      localStorage.setItem('localDigests', JSON.stringify(stored.slice(0, 50)));
    }
  } catch {}

  // Wait for app to initialize, then inject and open
  const _waitForReady = setInterval(() => {
    if (typeof DIGEST_SESSIONS !== 'undefined' && typeof switchTab === 'function') {
      clearInterval(_waitForReady);
      if (!DIGEST_SESSIONS.some(s => s.id === _injectedDigest.id)) {
        DIGEST_SESSIONS.unshift(_injectedDigest);
      }
      switchTab('digest');
      setTimeout(() => openDigest(_injectedDigest.id), 100);
    }
  }, 50);

  // Override back button: return to digest list instead of broken library
  const _origGoToLibrary = null;
  const _waitForLib = setInterval(() => {
    if (typeof goToLibrary === 'function' && typeof renderDigestList === 'function') {
      clearInterval(_waitForLib);
      const _orig = goToLibrary;
      window.goToLibrary = function() {
        if (S.digestMode) {
          // Return to digest tab instead of library
          S.playing = false; clearTimeout(S.timer); updatePlayBtn();
          if (typeof TTS !== 'undefined') TTS.stop();
          S.digestMode = false;
          S.digestBlocks = [];
          S.digestBoundaries = null;
          document.getElementById('blockIndicator').classList.add('hidden');
          document.getElementById('blockLabel').classList.add('hidden');
          document.getElementById('wordDisplay').className = 'word-display';
          document.getElementById('readerView').classList.remove('digest-reading');
          document.getElementById('readerView').classList.remove('active');
          document.getElementById('libraryView').classList.add('active');
          switchTab('digest');
          renderDigestList();
          document.title = 'RSVP Reader';
        } else {
          _orig();
        }
      };
    }
  }, 50);
})();
</script>`;

  // Insert before closing </body> (use lastIndexOf — first match may be inside a template string)
  const idx = html.lastIndexOf('</body>');
  html = html.slice(0, idx) + autoOpenScript + '\n' + html.slice(idx);

  return html;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}
