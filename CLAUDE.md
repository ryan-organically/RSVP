# RSVP Reader

Local-first speed-reading app with Dev Digest integration for Claude Code sessions.

## Architecture

- **Frontend:** Monolithic SPA at `public/index.html` (vanilla JS, no framework). All CSS + JS inline.
- **Storage:** Local-first by default. Book text in IndexedDB (`rsvp-cache` / `texts` store); library metadata, reading positions, bookmarks, highlights, digests, settings, and stats in `localStorage` under `rsvp:*` keys. No accounts. Nothing leaves the browser unless the user opts into cloud sync (below).
- **Server:** Three stateless functions. `api/proxy.js` — a Gutenberg CORS proxy, allowlisted to `gutenberg.org`, no database, no filesystem access. `api/digests.js` and `api/books.js` — opt-in cloud sync for digests and imported book text, Turso-backed via the zero-dependency `lib/turso.js` client. Both sync endpoints require a `SYNC_TOKEN` bearer token (compared with `timingSafeEqual`); the token's SHA-256 hash namespaces every row, so the token IS the account and no request can ever read another owner's rows. This design deliberately replaces the old pre-rewrite Turso backend that was removed for exposing all users' digests globally — never reintroduce an unauthenticated or un-namespaced read path.

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/digest` | Summarize the current Claude Code session and open in RSVP Reader |
| `/diff` | Digest working tree changes (staged + unstaged + untracked) |
| `/diff main` | Digest current branch vs main |
| `/diff <branch>` | Digest current branch vs any branch |
| `digest <path>` (shell, not slash) | Headless CLI at `~/.local/bin/digest`: mirror any text/markdown file into RSVP, no Claude session (`claude-digest.js --file`) |

Digests are saved to the browser's `localStorage` (key `rsvp:digests`). Cloud sync is **default-on** (since 2026-07-20): whenever `$SYNC_TOKEN` is exported, every digest the CLI renders (`/digest`, `/diff`, `digest <path>`) is pushed to `focal.wiki/api/digests` so it appears in the Dev Digest tab on any connected device (phone included, one-time token connect). This is the accumulate-on-computer → review-on-phone flow. Without the token, sync is silently skipped and everything stays local, so the app remains zero-credential for everyone else. `--no-sync` skips a run. `--phone` optionally also Taildrops the digest HTML to a tailnet device (see DIGEST_WORKFLOW.md).

## Dev Setup

```bash
npm run dev         # static dev server on localhost:3000 (no env vars)
# or, to also run the Gutenberg proxy locally:
vercel dev
```

No `.env.local` and no credentials are required for the app itself. Cloud sync additionally needs `TURSO_URL`, `TURSO_AUTH_TOKEN`, and `SYNC_TOKEN` on the server (Vercel env), and `SYNC_TOKEN` exported wherever the digest CLI runs — see `DIGEST_WORKFLOW.md`. Tests mock Turso, so `npm test` needs no env either.

## Key Rules

- All frontend code lives in `public/index.html` — do not split into separate files
- Use `public/index.html` for digest injection, never other HTML files
- Keep the app local-first by default: everything must work with zero credentials and no server round-trips. Server-side storage of user data is allowed ONLY behind the opt-in `SYNC_TOKEN` pattern used by `api/digests.js`/`api/books.js` (bearer auth, `timingSafeEqual`, token-hash owner namespacing). No unauthenticated reads, no cross-owner queries, no silent syncing, and nothing that reads the host filesystem or machine
- Do not commit copyrighted texts or any private/personal documents to `public/` — this is a public, open-source repo. The bundled `welcome.txt` is original, owned content
- Preserve the DOM/JS contract when restyling (ids, inline `onclick` handlers, `.view`/`.active`, `.hidden`, `.accent-dot.active`, `#wordDisplay .orp`, `#progressFill` `scaleX`, range inputs). See `public/takes/spec.md`
- No external AI API keys needed for slash commands — they run inline in Claude Code
