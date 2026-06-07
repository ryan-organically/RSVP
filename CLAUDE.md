# RSVP Reader

Local-first speed-reading app with Dev Digest integration for Claude Code sessions.

## Architecture

- **Frontend:** Monolithic SPA at `public/index.html` (vanilla JS, no framework). All CSS + JS inline.
- **Storage:** Fully local-first. Book text in IndexedDB (`rsvp-cache` / `texts` store); library metadata, reading positions, bookmarks, highlights, digests, settings, and stats in `localStorage` under `rsvp:*` keys. No accounts, no shared database, nothing leaves the browser.
- **Server:** A single stateless function, `api/proxy.js` — a Gutenberg CORS proxy, allowlisted to `gutenberg.org`, with no database and no filesystem access. This is the only `api/` file.

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/digest` | Summarize the current Claude Code session and open in RSVP Reader |
| `/diff` | Digest working tree changes (staged + unstaged + untracked) |
| `/diff main` | Digest current branch vs main |
| `/diff <branch>` | Digest current branch vs any branch |

Digests are saved to the browser's `localStorage` (key `rsvp:digests`). There is no cloud sync — the app is intentionally serverless and credential-free.

## Dev Setup

```bash
npm run dev         # static dev server on localhost:3000 (no env vars)
# or, to also run the Gutenberg proxy locally:
vercel dev
```

No `.env.local` and no credentials are required.

## Key Rules

- All frontend code lives in `public/index.html` — do not split into separate files
- Use `public/index.html` for digest injection, never other HTML files
- Keep the app local-first: no new server endpoints that store user data, and nothing that reads the host filesystem or machine. The only server code is the allowlisted `api/proxy.js`
- Do not commit copyrighted texts or any private/personal documents to `public/` — this is a public, open-source repo. The bundled `welcome.txt` is original, owned content
- Preserve the DOM/JS contract when restyling (ids, inline `onclick` handlers, `.view`/`.active`, `.hidden`, `.accent-dot.active`, `#wordDisplay .orp`, `#progressFill` `scaleX`, range inputs). See `public/takes/spec.md`
- No external AI API keys needed for slash commands — they run inline in Claude Code
