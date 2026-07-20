# 2026-07-18 — Cloud sync actually turned on; Focal Malleable bucket created

No code changes (no commit) — this was infra/ops: Vercel env, a prod redeploy, one
direct Turso DDL statement, and Malleable bucket setup.

## Cloud sync (SYNC_TOKEN) is live

Per `DIGEST_WORKFLOW.md`'s setup steps, finally executed:

- Generated a token, `vercel env add SYNC_TOKEN production`, exported it in
  `~/.bashrc` (same plaintext-export pattern already used there for
  `DISCORD_BOT_TOKEN`). Note: a var added to `.bashrc` mid-session doesn't
  appear in that session's already-running shell — Ubuntu's default `.bashrc`
  returns early for non-interactive shells before reaching any exports, and
  Claude Code's tool shell only picks up profile state at session start. Shows
  up correctly in any new session/terminal from here on.
- Redeployed via `vercel redeploy focal.wiki` (rebuilds the existing
  deployment/commit) rather than `vercel --prod` (which would have shipped
  whatever's sitting uncommitted locally, including the unverified gaze-pause
  camera code — deliberately avoided).

## Bug found + fixed: sync 502'd on first real use

`api/digests.js`'s `ensureSchema()` does `CREATE TABLE IF NOT EXISTS digests(...)`.
A `digests` table already existed in the Turso DB from the old pre-rewrite
backend (schema: `id, title, project, time, blocks, created_at` — no `owner`
column), so the `CREATE TABLE` silently no-op'd, then `CREATE INDEX ... ON
digests(owner, ...)` failed with `no such column: owner`.

Fix: renamed the old table to `digests_legacy_20260718` (4 old rows preserved,
all from a 2026-03-05 session about the digest infra itself — not dropped,
just out of the way) instead of deleting it, then redeployed so `ensureSchema`
created a fresh table with the correct columns (`id, owner, title, project,
time, blocks, created`). Verified end-to-end: a real digest synced and read
back correctly with the right schema.

**Not fixed, flagged for next touch:** `_ready = _ready || ensureSchema()` in
`api/digests.js` (and likely `api/books.js`, same pattern) caches a *rejected*
promise forever once `ensureSchema()` fails once — a rejected promise is still
a truthy object, so the short-circuit keeps replaying the same stale error for
that warm Lambda instance's whole lifetime, regardless of the DB's actual
state, until the next redeploy. This is exactly what made the first two sync
retries fail identically even after the schema was already fixed. Small fix
next time that file's touched: reset `_ready` to `null` inside a `.catch()`.

## Malleable bucket

No bucket existed for this project (26 buckets total across other client/
personal projects, e.g. `Roanoke`; RSVP/Focal just never got one). Created
`Focal` (`7a649a9f-5d92-4e24-ac5e-86b66310052e`), linked to
`~/dev/RSVP` (`mal buckets link ... --path`), seeded with a bootstrap ticket +
attached note carrying the context above plus the still-open items already
tracked in recent devlogs (gaze pause camera check, home.html positioning
decision, focal.wiki renewal date).
