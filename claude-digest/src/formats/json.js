/**
 * Format digest as RSVP Reader-compatible JSON.
 */
export function formatJSON(digest, meta = {}) {
  const id = slugify(digest.title) + '-' + Date.now().toString(36);
  return JSON.stringify({
    id,
    title: digest.title,
    project: digest.project || '',
    time: meta.timestamp || new Date().toISOString(),
    blocks: digest.blocks,
  }, null, 2);
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
