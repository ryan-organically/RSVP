---
name: diff
description: Generate a Dev Digest from git diffs. Pass a branch name (main, dev) to diff against, or omit for working tree. Add --sync to persist to cloud.
argument-hint: "[branch] [--sync]"
---

Generate a Dev Digest from git diffs. Works in any git repo. No external API key needed.

## Argument handling

- **`/diff`** — working tree only (staged + unstaged + untracked)
- **`/diff main`** — current branch vs main
- **`/diff dev`** — current branch vs dev
- **`--sync`** — also save locally and POST to cloud

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

### 2. Build JSON and open

Generate 10-20 tagged blocks. Each block is ONE verbose standalone sentence with file names and numbers. Tags: `done`, `critical`, `high`, `info`, `decision`.

Get the repo root and open in one shot — no intermediate files:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
node -e "
const fs = require('fs');
const digest = <PASTE THE JSON OBJECT HERE>;
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

### 3. Sync (only if --sync)

```bash
mkdir -p ~/.claude/digests
# Write JSON to ~/.claude/digests/<id>.json
curl -s -X POST "https://rsvp-reader-ecru.vercel.app/api/digests" \
  -H "Content-Type: application/json" \
  -d "$(cat ~/.claude/digests/<id>.json)"
```

Skip if no `--sync`.

### 4. Confirm

One line: "Digest opened." plus the title. If synced, add "Synced to cloud."
