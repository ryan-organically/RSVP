# Contributing to RSVP Reader

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** this repo and clone your fork locally
2. Run `npm install` to set up dependencies
3. Run `npm run dev` to start the local dev server on port 3000
4. Make your changes on a feature branch (never commit directly to `main` or `dev`)

## Project Structure

```
RSVP/
├── api/              # Vercel serverless API routes
│   ├── books/        # Book-specific endpoints
│   ├── db.js         # Database connection (Turso/libSQL)
│   ├── books.js      # Book listing endpoint
│   ├── digests.js    # Digest endpoint
│   └── proxy.js      # Proxy endpoint
├── public/           # Static frontend assets
│   ├── index.html    # Main app entry point
│   └── sw.js         # Service worker
├── vercel.json       # Vercel deployment config
└── package.json      # Node.js project config
```

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production — deployed to Vercel. PRs only, requires review. |
| `dev`  | Integration branch for testing. PRs only, requires review. |
| `feature/*` | Your working branches. Branch off `dev`. |
| `fix/*` | Bug fix branches. Branch off `dev` or `main` for hotfixes. |

## Pull Request Process

1. Branch off `dev` (or `main` for hotfixes)
2. Keep PRs focused — one feature or fix per PR
3. Fill out the PR template completely
4. All CI checks must pass before review
5. At least 1 approving review is required to merge

## CI Checks

Every PR automatically runs:

- **Lint & Validate** — JSON config validation, HTML structure checks, console.log detection
- **Security Audit** — npm dependency audit, hardcoded secret scanning
- **Vercel Build Check** — static asset verification, API route structure validation, build test

Fix any CI failures before requesting review.

## Code Guidelines

- **API routes** must export a default handler function
- **No hardcoded secrets** — use environment variables for database URLs, API keys, etc.
- **Keep `vercel.json` and `package.json` as valid JSON** — CI will catch syntax errors
- **Static assets** go in `public/`
- **Test locally** with `npm run dev` before pushing

## Environment Variables

The app uses these env vars in production (set in Vercel, never in code):

| Variable | Description |
|----------|-------------|
| `TURSO_DATABASE_URL` | Turso/libSQL database connection URL |
| `TURSO_AUTH_TOKEN` | Turso authentication token |

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bug reports
- Check existing issues before creating duplicates

## Questions?

Open a Discussion or comment on a relevant issue. We're happy to help!
