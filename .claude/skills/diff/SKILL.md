---
name: diff
description: Generate a Dev Digest from git diffs. Pass a branch name (main, dev) to diff against, or omit for working tree. Syncs to your cloud dev digests automatically when $SYNC_TOKEN is set.
argument-hint: "[branch]"
---

Generate a Dev Digest from git diffs. Works in any git repo. No external API key needed.

## Argument handling

- **`/diff`** — working tree only (staged + unstaged + untracked)
- **`/diff main`** — current branch vs main
- **`/diff dev`** — current branch vs dev

Digests **sync to your private cloud dev digests by default** (step 3) so they follow you across devices — accumulate them on your computer and read them on your phone. Sync is silently skipped when `$SYNC_TOKEN` is not exported, so with no token nothing leaves the machine (local-first). No `--sync` flag is needed anymore.

## Steps

### 1. Gather and read diffs

If a branch argument was provided:

```bash
git log --oneline <target>..HEAD
git diff <target>...HEAD --stat
git diff <target>...HEAD
```

If no branch argument:

```bash
git diff --cached --stat && git diff --stat
git diff --cached && git diff
git status --short
```

Also: `git branch --show-current` and `basename "$(git rev-parse --show-toplevel)"`

For untracked files, read their first ~60 lines each.

### 2. Build the digest JSON

Generate 10-20 tagged blocks. Each block is ONE verbose standalone sentence with file names and numbers. Tags: `done`, `critical`, `high`, `info`, `decision`.

Build the full digest object — it **must** include an `id` (a slug of the title plus a timestamp so it upserts cleanly), `title`, `project`, `time` (ISO), and `blocks`. Export it once as an env var so the open step and the sync step share the exact same object:

```bash
export DIGEST_JSON='{"id":"<title-slug>-<epoch-ms>","title":"...","project":"...","time":"<ISO-8601>","blocks":[{"tag":"done","text":"..."}]}'
```

### 3. Inject and open

Get the repo root and open in one shot — no intermediate files:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
node -e "
const fs = require('fs');
const digest = JSON.parse(process.env.DIGEST_JSON);
let html = fs.readFileSync('${REPO_ROOT}/public/index.html', 'utf-8');
const script = \`<script>
(function() {
  const d = \${JSON.stringify(digest)};
  function inject() {
    if (typeof DIGEST_SESSIONS === 'undefined' || typeof switchTab !== 'function' || typeof openDigest !== 'function') return setTimeout(inject, 50);
    DIGEST_SESSIONS.unshift(d);
    switchTab('digest');
    renderDigestList();
    setTimeout(() => openDigest(d.id), 200);
  }
  if (document.readyState === 'complete') inject();
  else window.addEventListener('load', inject);
})();
</script>\`;
const idx = html.lastIndexOf('</body>');
html = html.slice(0, idx) + script + '\n' + html.slice(idx);
const out = '/mnt/c/temp-digest-' + Date.now() + '.html';
fs.writeFileSync(out, html);
console.log(out.replace('/mnt/c/', 'C:\\\\'));
" | xargs -I{} powershell.exe -Command "Start-Process '{}'"
```

**IMPORTANT:** Use `public/index.html` from the RSVP repo root.

### 4. Sync to your dev digests (automatic; skipped without a token)

Push the same digest to your private cloud space so it reaches your phone. This runs every time and is a no-op when `$SYNC_TOKEN` is not set, so nothing leaves the machine without a token. The bearer token *is* the account — the server namespaces every row by its hash, so only you can read your digests.

```bash
if [ -n "$SYNC_TOKEN" ]; then
  curl -s -X POST "${FOCAL_SYNC_URL:-https://focal.wiki/api/digests}" \
    -H "Authorization: Bearer $SYNC_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$DIGEST_JSON" >/dev/null && echo "Synced to your dev digests." \
    || echo "Sync failed (digest is still saved locally in the reader)."
fi
```

### 5. Confirm

One line: "Digest opened." plus the title. If it synced, add "Synced to your dev digests — pull it on your phone from the Dev Digest tab."
