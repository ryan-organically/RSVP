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

Claude reviews the full conversation history and classifies everything into 10-20 tagged blocks. Each block is a verbose, standalone sentence with file names, line counts, and specifics.

### /diff [branch] (Git Diff Digest)

Runs git commands to gather context, reads actual diff content, then generates tagged blocks. With a branch argument, diffs all commits since divergence. Without, analyzes working tree changes.

### Delivery Pipeline

Both commands follow the same delivery:

1. **Generate** — JSON digest with tagged blocks
2. **Save locally** — `~/.claude/digests/<id>.json`
3. **POST to API** — `/api/digests` on your RSVP Reader instance (persists to Turso)
4. **Open browser** — Injects digest into RSVP Reader HTML, opens with auto-play

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

- **Local:** `~/.claude/digests/*.json`
- **Remote:** Turso DB via `POST /api/digests` on your deployed instance
- **Browser:** RSVP Reader loads from API on the Dev Digest tab

---

## Legacy: claude-digest CLI

The `claude-digest` CLI in the `claude-digest/` directory still exists but is superseded by the slash commands. The CLI requires `ANTHROPIC_API_KEY` and parses `.jsonl` session transcripts — the slash commands do neither, generating digests directly from session context.
