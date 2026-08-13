# RSVP Reader

Local-first speed-reading app with Dev Digest integration for Claude Code sessions.

## This repo is PUBLIC

Everything committed here is world-readable (github.com/ryan-organically/RSVP). Before any commit or push:

- **Scan the outgoing diff for secrets** — tokens, API keys, bearer values, `.env` contents, real contact info. `SYNC_TOKEN` lives only in `~/.bashrc` and Vercel env; its value must never appear in a tracked file (devlogs included — they may describe the token pattern, never the value).
- **Check sensitive routes/API surface** — any change under `api/` or to sync code must preserve the security contract in Key Rules below: bearer auth via `timingSafeEqual`, token-hash owner namespacing, no unauthenticated or cross-owner read/write paths, no new endpoint that touches the host filesystem or leaks env. Re-read the route's auth path end-to-end before shipping a change to it.
- Devlogs with sensitive security/architecture details or keys stay out of the repo (see motherboard convention); write them elsewhere or sanitize first.

## Architecture

- **Frontend:** Monolithic SPA at `public/index.html` (vanilla JS, no framework). All CSS + JS inline.
- **Storage:** Local-first by default. Book text in IndexedDB (`rsvp-cache` / `texts` store); library metadata, reading positions, bookmarks, highlights, digests, settings, and stats in `localStorage` under `rsvp:*` keys. No accounts. Nothing leaves the browser unless the user opts into cloud sync (below).
- **Server:** Four stateless functions, in two classes.
  - *Storage-touching, authenticated:* `api/digests.js` and `api/books.js` — opt-in cloud sync for digests and imported book text, Turso-backed via the zero-dependency `lib/turso.js` client. Both require a `SYNC_TOKEN` bearer token (compared with `timingSafeEqual`); the token's SHA-256 hash namespaces every row, so the token IS the account and no request can ever read another owner's rows. This design deliberately replaces the old pre-rewrite Turso backend that was removed for exposing all users' digests globally — never reintroduce an unauthenticated or un-namespaced read path. Note the model is currently **single-tenant** (one server-side token, Ryan's); it is personal sync, not a multi-tenant API, and must not be turned into one by accident.
  - *Content-carrying, stateless:* `api/proxy.js` (Gutenberg CORS proxy) and `api/read.js` (public document extraction). These store nothing, authenticate nothing, and read no user data. All their outbound traffic goes through `lib/fetch-safe.js`: https only, host allowlist, public-IP checks, manually re-validated redirects, streamed byte cap.
- **The rule that keeps those two classes apart:** content-carrying surfaces are stateless; storage-touching surfaces are authenticated. Text reaches the reader from an external surface by URL **fragment** (`#t=` / `#u=` / `#p=`, never transmitted to a server), by `postMessage` from the opening window (`#post=1`), or by the client fetching a public URL itself. Never by POSTing user text to focal.wiki. See `openFromFragment()` in `public/index.html`.
- **MCP surface:** `mcp/` is `@focal/mcp`, a zero-dependency stdio MCP server (raw JSON-RPC, no SDK) exposing `focal_open` (text → fragment link, opened locally) and `focal_read_url` (public doc → metadata + link, prose only on request so agents don't burn context). It runs on the user's machine, stores nothing, and never writes to stdout except protocol messages — a stray byte there corrupts the session, so log to stderr only. `index.js` must not start the server on import; the stdio loop is behind an `isMain` guard so tests and consumers can reuse `focalUrl`.
- **Aggregate metrics:** `lib/metrics.js` + `api/metrics.js`. Server-side counting of requests already served, bucketed by day and one low-cardinality dimension. There is **no client telemetry and no write route** — nothing a caller sends can create or inflate a counter, and no beacon exists anywhere in the app. Reads require `SYNC_TOKEN`. Keep it that way: the "nothing leaves your browser" claim on the landing page and in `embed.html` has to stay literally true.
- **Embed surface:** `public/embed.js` (3.4KB gzipped, zero deps) puts a "Read in Focal" button on any third-party page, extracting text client-side and handing it over by fragment or postMessage. `public/embed.html` is its docs + live playground. Nothing is uploaded, no cookies are set, and no request is made until a visitor clicks — that property is the product, so do not add telemetry to it without an explicit opt-in flag and aggregate-only counters.

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
