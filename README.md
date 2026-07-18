# RSVP Reader

Speed read anything. One word at a time, with ORP (Optimal Recognition Point) highlighting.

**Local-first and private.** Your library, reading positions, bookmarks, and notes live entirely in your own browser. By default nothing is uploaded to any server and the app runs with zero credentials. An optional, token-gated cloud sync can mirror your digests and imported books across devices — off unless you turn it on.

**Demo:** [focal.wiki](https://focal.wiki)

---

## Features

- **RSVP speed reading** with ORP highlighting and adjustable WPM (50–1200)
- **First-run onboarding + WPM calibration** so new readers find their pace fast
- **Command palette** (`Cmd`/`Ctrl` + `K`) for everything: open a book, jump to a chapter, change settings, search
- **Reading stats + streaks**, daily goals, and per-book time estimates (all local)
- **Bionic reading** and a **comfort font** mode, plus **multi-word chunking** (1/2/3 words per flash)
- **Smart pause** at paragraphs, **peek** (`P`) to re-read the current sentence, and a 3-2-1 **resume countdown**
- **Highlights** (`H`) and **bookmarks** (`B`) with one-tap jump and Markdown export
- **Library management** — upload `.txt`/`.md`/`.pdf`, drag-and-drop, or paste text (pasted web HTML is cleaned automatically)
- **Free Library** — search and download 60,000+ public-domain Project Gutenberg books
- **Dev Digest** — speed-read color-coded summaries of coding sessions
- **Optional cloud sync** — a single secret token syncs digests and imported books across devices; no accounts, no email, delete the token and the link is gone
- **Installable PWA** with offline reading of any book you have opened
- **Dark/light theme**, custom accent colors, and named presets
- **Accessible**: keyboard-first, focus rings, ARIA labels, reduced-motion aware, pinch-zoom enabled

## How your data is stored

Everything is on-device. There are no accounts and no shared database.

| Data | Where |
|------|-------|
| Book text | IndexedDB (`rsvp-cache`) |
| Library, positions, bookmarks, highlights, digests, settings, stats | `localStorage` (`rsvp:*` keys) |

The only network calls are: the Google Fonts and pdf.js CDNs, the Project Gutenberg search API (`gutendex.com`), and the bundled `/api/proxy` function, which downloads Gutenberg book text. The proxy is stateless, allowlisted to `gutenberg.org`, and never touches a database or the filesystem.

**Optional cloud sync:** if you paste a sync token into the Dev Digest tab (or export `SYNC_TOKEN` for the CLI), digests and imported book text also sync through `/api/digests` and `/api/books`, backed by Turso. The token is the whole account: rows are namespaced by a hash of it, requests without it are rejected, and no endpoint can list or read another token's data. Leave the token blank and the app never talks to the sync endpoints at all.

## Setup

No database, no environment variables, no accounts.

```bash
git clone https://github.com/ryan-organically/RSVP.git
cd RSVP
npm run dev          # static dev server on http://localhost:3000
```

`npm run dev` is enough for the full app locally except downloading Gutenberg books, which needs the proxy. To run the proxy too, use `vercel dev` (no env vars required).

### Deploy

```bash
vercel --prod
```

No environment variables are required for the core app. Any static host works; on Vercel the `/api/proxy` function powers Gutenberg downloads. To enable the optional cloud sync, set `TURSO_URL`, `TURSO_AUTH_TOKEN`, and a self-chosen `SYNC_TOKEN` in the Vercel project (see [DIGEST_WORKFLOW.md](DIGEST_WORKFLOW.md)); without them the sync endpoints simply refuse and the app stays fully local.

### Claude Code Integration

The repo ships with Claude Code slash commands. Open the project with [Claude Code](https://claude.com/claude-code) and use `/digest` or `/diff`. Digests are stored in your browser's `localStorage` and accumulate across sessions. See `CLAUDE.md` and `.claude/skills/` for details.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS — single file (`public/index.html`) |
| Storage | IndexedDB + localStorage (local-first, in-browser) |
| Server | Stateless functions: `api/proxy.js` (Gutenberg CORS proxy) + opt-in `api/digests.js` / `api/books.js` (token-gated sync, Turso) |
| Hosting | Vercel (or any static host) |

## Dev Digest

The reader doubles as a Dev Digest viewer — color-coded summaries of coding sessions or git diffs, speed-readable at 300–600 WPM. Digests are created by pasting notes (first line is the title, paragraphs become blocks) or via Claude Code:

| Command | What it does |
|---------|-------------|
| `/digest` | Summarize the current session |
| `/diff` | Digest working tree changes |
| `/diff main` | Digest current branch vs main |

See [DIGEST_WORKFLOW.md](DIGEST_WORKFLOW.md). Digests live in your browser's `localStorage`, and optionally sync across devices with a `SYNC_TOKEN` (the `--sync` flag on the CLI).

### Tag System

| Tag | Color | Use |
|-----|-------|-----|
| `critical` | Red | Bugs, breaking changes, security issues |
| `high` | Amber | Warnings, regressions, things to watch |
| `done` | Green | Completed work, shipped features |
| `info` | Blue | Architecture context, observations |
| `decision` | Purple | Decisions made or still needed |

---

## Project Structure

```
public/
  index.html          # Entire frontend (CSS + JS inline)
  sw.js               # ServiceWorker for offline caching
  welcome.txt         # Public-domain welcome / tutorial read
  manifest.webmanifest# PWA manifest
api/
  proxy.js            # Stateless, allowlisted Gutenberg CORS proxy (no DB, no FS)
  digests.js          # Opt-in digest sync (SYNC_TOKEN bearer auth, Turso)
  books.js            # Opt-in imported-book sync (same auth pattern)
lib/
  turso.js            # Zero-dependency Turso/libSQL HTTP client
claude-digest/        # Digest formatter + browser launcher CLI
.claude/skills/       # /digest and /diff slash commands
vercel.json           # Cache headers
```

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Test locally with `npm run dev`
5. Open a PR

## License

MIT — see [LICENSE](LICENSE).
