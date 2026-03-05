# RSVP Reader

Speed read anything. One word at a time, with ORP (Optimal Recognition Point) highlighting.

No build step. No framework. One HTML file, a few serverless functions, and a SQLite database.

**Demo:** [rsvp-reader-ecru.vercel.app](https://rsvp-reader-ecru.vercel.app)

---

## Features

- **RSVP speed reading** with ORP highlighting and adjustable WPM (50–1200)
- **Library management** — upload `.txt`, `.docx`, `.pdf` or paste text directly
- **Reading position sync** — pick up where you left off across devices
- **Bookmarks** and **chapter detection** (TOC sidebar + minimap)
- **Free Library** — search and download 60,000+ Project Gutenberg books
- **Dev Digest** — speed-read color-coded summaries of coding sessions
- **Offline support** via ServiceWorker
- **Dark/light theme** with customizable accent colors
- **Keyboard-driven** — Space, arrows, `[`/`]` font size, Home/End jump

## Setup

### Prerequisites

- Node.js 18+
- A [Turso](https://turso.tech) database (free tier works)
- A [Vercel](https://vercel.com) account (for deployment)

### Local Development

```bash
git clone https://github.com/ryan-organically/RSVP.git
cd RSVP
npm install

# Create .env.local with your Turso credentials
echo 'TURSO_URL=libsql://your-db.turso.io' >> .env.local
echo 'TURSO_AUTH_TOKEN=your-token' >> .env.local

# Start the dev server (serves frontend + API functions)
vercel dev
```

The app will be available at `http://localhost:3000`.

> **Note:** `npm run dev` serves only the static frontend (no API). Use `vercel dev` to run the full stack locally.

### Deploy

```bash
vercel --prod
```

Set `TURSO_URL` and `TURSO_AUTH_TOKEN` in your Vercel project environment variables. The database schema auto-creates on first request.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS — single file (`public/index.html`) |
| Backend | Vercel serverless functions (`api/`) |
| Database | [Turso](https://turso.tech) (LibSQL/SQLite) |
| Hosting | Vercel |

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/books` | GET | List saved books |
| `/api/books` | POST | Add a book |
| `/api/books/[id]` | GET/DELETE | Book metadata / delete |
| `/api/books/[id]/text` | GET | Book text content (gzip) |
| `/api/books/[id]/position` | GET/PUT | Reading position |
| `/api/books/[id]/bookmarks` | GET/POST/DELETE | Bookmarks |
| `/api/digests` | GET/POST | Dev digest sessions |

## Dev Digest

The RSVP Reader doubles as a Dev Digest viewer — color-coded summaries of coding sessions or git diffs, speed-readable at 300–600 WPM.

Works with [Claude Code](https://claude.com/claude-code) slash commands:

| Command | What it does |
|---------|-------------|
| `/digest` | Summarize the current session |
| `/diff` | Digest working tree changes |
| `/diff main` | Digest current branch vs main |

See [DIGEST_WORKFLOW.md](DIGEST_WORKFLOW.md) for the full system.

### Tag System

| Tag | Color | Use |
|-----|-------|-----|
| `critical` | Red | Bugs, breaking changes, security issues |
| `high` | Orange | Warnings, regressions, things to watch |
| `done` | Green | Completed work, shipped features |
| `info` | Blue | Architecture context, observations |
| `decision` | Purple | Decisions made or still needed |

---

## Project Structure

```
public/
  index.html          # Entire frontend (CSS + JS inline)
  sw.js               # ServiceWorker for offline caching
  generative-energy.txt  # Bundled book
  the-verdict.txt     # Bundled book
  nabre.txt           # Bundled NABRE Bible text
api/
  db.js               # Turso client + schema migration
  books.js            # Library CRUD
  books/[id].js       # Single book operations
  books/[id]/text.js  # Raw text endpoint
  books/[id]/position.js
  books/[id]/bookmarks.js
  proxy.js            # Gutenberg proxy
  digests.js          # Digest sessions
claude-digest/        # Legacy CLI for digest generation
vercel.json           # Routing + cache headers
```

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Test locally with `vercel dev`
5. Open a PR

## License

MIT
