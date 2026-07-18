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
5. **Sync** *(automatic when a token is set)* — Both `/digest` and `/diff` POST the digest to `/api/digests` on focal.wiki whenever `$SYNC_TOKEN` is exported, so it lands in your dev digests on every device. With no token the step is silently skipped and the digest stays local

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

- **Browser localStorage** — digests persist in the `rsvp:digests` key (up to 100), available in the Dev Digest tab
- **Cloud sync** *(opt-in via token)* — once `$SYNC_TOKEN` is exported, `/digest` and `/diff` automatically POST each digest to `/api/digests` on focal.wiki (Turso-backed), so it shows up on every device. The token is the opt-in: without it, sync is skipped and everything stays local. This is the accumulate-on-computer → review-on-phone path: run digests during the day, then open focal.wiki on your phone at night, paste the same token, and pull the lot

### Cloud sync setup (cross-device, via focal.wiki)

The `/api/digests` endpoint (`api/digests.js`) stores digests in the project's Turso database, gated by a single shared secret. One-time setup:

1. **Pick a secret** and set it in the Vercel project env:
   `vercel env add SYNC_TOKEN production` (paste a long random string). Turso vars (`TURSO_URL`, `TURSO_AUTH_TOKEN`) are already provided by the integration.
2. **Redeploy:** `vercel --prod` (so `api/digests.js` ships).
3. **CLI (push):** export the same secret where Claude Code runs — `export SYNC_TOKEN=…` — then `/digest` auto-syncs (or run any digest with `--sync`).
4. **Reader (read):** open focal.wiki on any device → **Dev Digest** tab → paste the token into the sync box → **Connect**. Digests then pull on every visit, and the back button / tab become your full history.

The token *is* the key to your private digest space — anyone with it can read/write your digests, so keep it long and secret. The reader sends it only to focal.wiki over HTTPS; books and reading stay 100% local as before.

---

## claude-digest CLI

The `claude-digest` CLI in the `claude-digest/` directory handles formatting and browser display only. Digests are generated inline by Claude Code — no API key needed. Pipe digest JSON into the CLI:

```bash
echo '<digest-json>' | node ./claude-digest/bin/claude-digest.js --inject --open
```
