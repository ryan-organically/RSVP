# Dev Digest — Claude Code Slash Commands

Generate speed-readable summaries of sessions and git diffs, delivered to the RSVP Reader.

---

## Commands

| Command | What it does |
|---------|-------------|
| `/digest` | Summarize the **current session** — tasks, decisions, changes, issues |
| `/diff` | Digest **working tree** (staged + unstaged + untracked) |
| `/diff main` | Digest current branch vs **main** |
| `/diff dev` | Digest current branch vs **dev** |

All commands are zero-config. No API key needed — the current Claude Code session generates the digest inline.

---

## How It Works

### /digest (Session Summary)

Claude reviews the full conversation history and classifies everything into 5-8 tagged blocks. Each block is a concise sentence with file names and specifics.

### /diff [branch] (Git Diff Digest)

Runs git commands to gather context, reads actual diff content, then generates tagged blocks. With a branch argument, diffs all commits since divergence. Without, analyzes working tree changes.

### Delivery Pipeline

Both commands follow the same delivery:

1. **Generate** — Claude Code produces JSON digest with tagged blocks inline (no external API call)
2. **Format** — CLI injects digest into a copy of `public/index.html`
3. **Persist** — Injected script saves to browser `localStorage` (accumulates across sessions)
4. **Open browser** — Launches the HTML file (macOS/Windows/WSL/Linux)
5. **Sync** *(optional)* — With `--sync`, POSTs to `/api/digests` on your RSVP instance

---

## Tag System

| Tag | Color | When to use |
|-----|-------|-------------|
| `critical` | Red | Bugs, breaking changes, security issues |
| `high` | Orange | Warnings, regressions, concerns |
| `done` | Green | Completed work, shipped features |
| `info` | Blue | Architecture context, observations |
| `decision` | Purple | Decisions made or needed |

---

## Skill File Locations

| Skill | Path | Scope |
|-------|------|-------|
| `/digest` | `<project>/.claude/skills/digest/SKILL.md` | Per-project |
| `/diff` | `~/.claude/skills/diff/SKILL.md` | Global (any repo) |

---

## Digest Schema

```json
{
  "id": "slugified-title-timestamp",
  "title": "Session digest — feature branch cleanup",
  "project": "my-project",
  "time": "2026-03-05T12:00:00.000Z",
  "blocks": [
    { "tag": "done", "text": "Verbose sentence about what was completed with file names and numbers." },
    { "tag": "critical", "text": "Verbose sentence about a breaking issue." }
  ]
}
```

---

## Storage

- **Browser localStorage** — digests persist in `localDigests` key (up to 50), available in the Dev Digest tab
- **Remote** *(opt-in)* — `POST /api/digests` on your deployed RSVP instance (requires `--sync` flag)

---

## claude-digest CLI

The `claude-digest` CLI in the `claude-digest/` directory handles formatting and browser display only. Digests are generated inline by Claude Code — no API key needed. Pipe digest JSON into the CLI:

```bash
echo '<digest-json>' | node ./claude-digest/bin/claude-digest.js --inject --open
```
