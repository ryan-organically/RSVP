# Books sync 502: legacy table blocked the rewritten schema

**Symptom (reproduced):** every request to `/api/books` returned 502 with
`turso: SQLite input error: no such column: owner`. Digests sync was unaffected.

**Cause:** the production Turso DB still had the pre-rewrite `books` table
(`id PRIMARY KEY, title, word_count, source, added_at, content` — 21 rows from
2026-02, mostly Gutenberg imports). `ensureSchema()` uses `CREATE TABLE IF NOT
EXISTS`, which no-ops against an existing table of any shape, so the rewritten
owner-namespaced schema never materialized. The digests table didn't hit this
because it was renamed aside during the July rewrite (`digests_legacy_20260718`)
— books never got the same migration.

**Fix (2026-08-07, applied directly against Turso via `lib/turso.js`):**

1. `ALTER TABLE books RENAME TO books_legacy_2026_02` (kept, not dropped — 21
   rows preserved; Gutenberg entries self-heal from gutenId anyway and the one
   non-Gutenberg row was OCR garbage).
2. Created the current schema verbatim from `ensureSchema()` (books table +
   `idx_books_owner`), since warm function instances cache `_ready` and would
   otherwise error until their next cold start.

**Takeaway:** `CREATE TABLE IF NOT EXISTS` is not a migration. If the schema in
`ensureSchema()` changes again, rename the old table aside (the
`*_legacy_YYYYMMDD` pattern now has two precedents) or add a real migration
step. `books_legacy_2026_02` can be dropped once nobody misses it.
