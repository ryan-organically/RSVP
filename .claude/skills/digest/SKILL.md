---
name: digest
description: Generate a Dev Digest summary of the current Claude Code session and open it in the RSVP Reader
argument-hint: "[--sync]"
---

Generate a session digest and open it in the RSVP Reader. No external API key needed.

## Steps

### 1. Session picker

Run this fast scanner (only reads first 20 lines per file):

```bash
python3 << 'PYEOF'
import json, os, re, subprocess
from datetime import datetime

repo = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
project_key = repo.replace("/", "-")
project_dir = os.path.join(os.path.expanduser("~/.claude/projects"), project_key)

sessions = []
for f in os.listdir(project_dir):
    if not f.endswith('.jsonl'):
        continue
    path = os.path.join(project_dir, f)
    if not os.path.isfile(path):
        continue
    first_msg = None
    timestamp = None
    with open(path) as fh:
        for i, line in enumerate(fh):
            if i > 20:
                break
            try:
                obj = json.loads(line)
            except:
                continue
            if obj.get('type') == 'user' and obj.get('message', {}).get('role') == 'user':
                content = obj['message'].get('content', '')
                if isinstance(content, list):
                    content = ' '.join(c.get('text', '') for c in content if c.get('type') == 'text')
                content = re.sub(r'<[^>]+>', '', content).strip()
                if content and not first_msg:
                    first_msg = content[:60].split('\n')[0]
                    timestamp = obj.get('timestamp', '')
    if first_msg:
        size_kb = os.path.getsize(path) / 1024
        dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        sessions.append({"ts": timestamp, "path": path, "label": f"{dt.strftime('%b %d %H:%M')} ({size_kb:.0f}KB)", "desc": first_msg})

sessions.sort(key=lambda x: x['ts'], reverse=True)
print(json.dumps(sessions[:6]))
PYEOF
```

Immediately use **AskUserQuestion** with the results:

- `header`: "Session"
- `question`: "Which session to digest?"
- Option 1: `label` = "Current session", `description` = "This conversation"
- Options 2-4: from script output — `label` = the `label` field, `description` = the `desc` field

The auto-included "Other" option covers older sessions.

- **"Current session"** → skip to **Step 3**.
- **Past session** → continue to **Step 2** with that session's `path`.
- **"Other"** → ask the user which session they want and re-run.

### 2. Load past session

```bash
python3 << 'PYEOF'
import json, re

path = "<REPLACE WITH SELECTED SESSION PATH>"

messages = []
with open(path) as fh:
    for line in fh:
        try:
            obj = json.loads(line)
        except:
            continue
        if obj.get('type') == 'user' and obj.get('message', {}).get('role') == 'user':
            content = obj['message'].get('content', '')
            if isinstance(content, list):
                content = ' '.join(c.get('text', '') for c in content if c.get('type') == 'text')
            content = re.sub(r'<[^>]+>', '', content).strip()
            if content:
                messages.append(f"USER: {content[:300]}")
        elif obj.get('type') == 'assistant':
            msg = obj.get('message', {})
            parts = msg.get('content', [])
            if isinstance(parts, list):
                text = ' '.join(p.get('text', '') for p in parts if p.get('type') == 'text')
            else:
                text = str(parts)
            text = text.strip()
            if text:
                messages.append(f"ASSISTANT: {text[:500]}")

for m in messages[:120]:
    print(m)
    print("---")
PYEOF
```

Read this output. This IS the session to digest.

### 3. Build JSON

Generate 10-20 tagged blocks. Each block is ONE verbose standalone sentence with file names, line counts, and specifics.

Tags: `done` (green), `critical` (red), `high` (orange), `info` (blue), `decision` (purple).

```json
{
  "id": "<slugified-title>-<timestamp>",
  "title": "Session digest — <brief description>",
  "project": "<basename of repo>",
  "time": "<ISO 8601 now>",
  "blocks": [
    { "tag": "done", "text": "..." },
    ...
  ]
}
```

### 4. Open in RSVP Reader

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
" | xargs -I{} powershell.exe -Command \"Start-Process '{}'\"
```

**IMPORTANT:** Use `public/index.html` from the RSVP repo root.

### 5. Sync (only if --sync)

```bash
mkdir -p ~/.claude/digests
curl -s -X POST "https://rsvp-reader-ecru.vercel.app/api/digests" \
  -H "Content-Type: application/json" \
  -d "$(cat ~/.claude/digests/<id>.json)"
```

Skip if no `--sync`.

### 6. Confirm

One line: "Digest opened." plus the title. If synced, add "Synced to cloud."
