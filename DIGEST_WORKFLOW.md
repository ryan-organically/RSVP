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
4. **Open browser** — Launches the HTML file in the default browser (macOS/Windows/WSL/Linux). An experimental `--mini` flag exists for a 500x500 bottom-right app window, but it is **broken/unproven** — in testing the windows opened on unreachable Windows virtual desktops — so the full browser tab remains the default
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
- **Cloud sync** *(default-on since 2026-07-20)* — every digest the CLI renders (`/digest`, `/diff`, `digest <path>`) POSTs to `/api/digests` on focal.wiki (Turso-backed) whenever `$SYNC_TOKEN` is exported, so it shows up in the Dev Digest tab on every connected device. This is the accumulate-on-computer → review-on-phone path. No token → sync silently skips and everything stays local. `--no-sync` skips one run; `--sync` is now redundant (kept for compatibility)

### Cloud sync setup (cross-device, via focal.wiki)

The `/api/digests` endpoint (`api/digests.js`) stores digests in the project's Turso database, gated by a single shared secret. One-time setup:

1. **Pick a secret** and set it in the Vercel project env:
   `vercel env add SYNC_TOKEN production` (paste a long random string). Turso vars (`TURSO_URL`, `TURSO_AUTH_TOKEN`) are already provided by the integration.
2. **Redeploy:** `vercel --prod` (so `api/digests.js` ships).
3. **CLI (push):** export the same secret where Claude Code runs — `export SYNC_TOKEN=…` — then `/digest` auto-syncs (or run any digest with `--sync`).
4. **Reader (read):** open focal.wiki on any device → **Dev Digest** tab → paste the token into the sync box → **Connect**. Digests then pull on every visit, and the back button / tab become your full history.

The token *is* the key to your private digest space — anyone with it can read/write your digests, so keep it long and secret. The reader sends it only to focal.wiki over HTTPS; books and reading stay 100% local as before.

### Mobile access

The Dev Digest tab on the phone is the primary mobile path: open focal.wiki → Dev Digest →
connect once with the sync token (saved in the browser after that). Because sync is
default-on, every digest generated during the day is waiting there.

**One-tap device onboarding:** opening `https://focal.wiki/#connect=<token>` on any device
stores the token, scrubs it from the address bar (it travels in the URL fragment, so it is
never sent to the server), lands on the Dev Digest tab, and pulls. Easiest way to get the
link onto a phone: Taildrop a small HTML page containing it (`tailscale file cp`). This
replaces typing the 64-char token on a phone keyboard — the step that historically never
happened, which is why PC digests "never landed" on the phone even though the cloud had them.

### Auto-digest hook (responses > 500 words)

A global Claude Code Stop hook (`~/.claude/hooks/auto-digest.mjs`, registered in
`~/.claude/settings.json`) checks every finished response; anything over 500 words is
automatically mirrored into the RSVP mini window via `claude-digest --last --exact
--transcript <path> --open`. `--exact` takes the literal final response (no fall-back to an
earlier long answer), and a content-hash state file dedupes re-fires from resume/compact.
Sync to focal.wiki rides along whenever `$SYNC_TOKEN` is set, so long answers land on the
phone with zero keystrokes.

**Optional extra — `--phone` (Taildrop):** pass `--phone` to also push the rendered digest
HTML to a tailnet device via `tailscale file cp` (device from `$DIGEST_TAILDROP` or
`{"taildrop": "<device>"}` in `~/.config/claude-digest/config.json`; names as shown in
`tailscale status`). Files arrive as `<title-slug>-<HHMM>.html` in the phone's Tailscale
app, each a self-contained RSVP page. Best-effort: failures log one stderr line and
nothing else is affected. This is opt-in per run, not automatic.

---

## `digest <path>` — file mode (headless)

Any text/markdown file can be mirrored into the RSVP Reader without a Claude session,
via the `--file` flag or the `digest` wrapper installed at `~/.local/bin/digest`:

```bash
digest ~/dev/CLAUDE.md            # open in RSVP + auto-sync to focal.wiki's Dev Digest tab
digest notes.md --no-open         # sync only, no browser window
digest notes.md --no-sync         # local only, skip focal.wiki
digest notes.md --phone           # also Taildrop the HTML to the tailnet phone
node ./claude-digest/bin/claude-digest.js --file <path> --open   # same, without the wrapper
```

The file is split into RSVP blocks per line (markdown syntax stripped, code fences skipped),
titled after its basename, and project-tagged from its git repo (or parent directory).

---

## claude-digest CLI

The `claude-digest` CLI in the `claude-digest/` directory handles formatting and browser display only. Digests are generated inline by Claude Code — no API key needed. Pipe digest JSON into the CLI:

```bash
echo '<digest-json>' | node ./claude-digest/bin/claude-digest.js --inject --open
```
