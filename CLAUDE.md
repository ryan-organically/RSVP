# RSVP Reader

Speed-reading app with Dev Digest integration for Claude Code sessions.

## Architecture

- **Frontend:** Monolithic SPA at `public/index.html` (vanilla JS, no framework)
- **Backend:** Vercel Functions + Turso SQLite (`api/` directory)
- **Database:** `@libsql/client` connecting to Turso

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/digest` | Summarize the current Claude Code session and open in RSVP Reader |
| `/diff` | Digest working tree changes (staged + unstaged + untracked) |
| `/diff main` | Digest current branch vs main |
| `/diff <branch>` | Digest current branch vs any branch |

Add `--sync` to any command to persist the digest to cloud.

## Dev Setup

```bash
npm install
vercel dev          # runs on localhost:3000
```

Requires `.env.local` with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

## Key Rules

- All frontend code lives in `public/index.html` — do not split into separate files
- Use `public/index.html` for digest injection, never other HTML files
- API routes are Vercel Functions in `api/`
- No external AI API keys needed for slash commands — they run inline in Claude Code
