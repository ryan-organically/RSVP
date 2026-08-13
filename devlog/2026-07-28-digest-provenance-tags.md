# 2026-07-28 — Digest provenance tags (bucket/ticket) + real block classification

## Phone sync diagnosis (first half of session)

"Digests still not porting to my phone" — every leg verified healthy from the
computer: API 200 with today's digests in the cloud, deployed HTML byte-identical
to local (connect handler present), SW stale-while-revalidate and never caching
the API. Only remaining failure point: the phone's browser context has no token.
Likely iOS storage isolation — a QR scan connects **Safari**, but a home-screen
PWA gets its own separate localStorage (and the Taildropped connect page may have
opened inside the Tailscale app's webview). Fresh connect QR regenerated onto the
Windows screen for a re-scan (Camera app → Safari). Diagnostic tell on-device:
Dev Digest tab → ↻ Refresh; "enter a token first" = unconnected context.

## Digest provenance: repo + Malleable bucket + kanban tickets

Ryan: "digests should be tagged with repo/malleable bucket and even the
associated kanban ticket. 'info × 18' isn't really informational."

Session shape gains an optional `meta`:
`{ bucket: {id,name}, tickets: [{id,title,stage}] }` (top-level `project` was
already the repo name; now it's rendered).

- **CLI (`claude-digest`)**: `resolveBucket()` runs `mal buckets current --json`
  from the repo root, cached in `~/.config/claude-digest/cache.json` (7d hit TTL,
  1h miss TTL so late linking gets picked up). Ticket association intersects
  UUIDs the session *worked with* against `mal tasks ls --json`. Crucial
  refinement: `collectUuids()` scans only typed user text, assistant prose, and
  tool-call **inputs** — tool RESULTS are excluded, because one `mal tasks ls`
  in a session dumps the whole board's UUIDs and (in the first smoke test)
  associated all 5 tickets falsely. `--ticket <id>` (repeatable) forces an
  association manually. All best-effort: no `mal`, no link, or timeout → digest
  ships untagged.
- **API (`api/digests.js`)**: new `meta TEXT` column (guarded
  `ALTER TABLE ... ADD COLUMN` with catch for pre-existing deploys), opaque JSON
  capped at 10k, round-tripped in GET/POST. Same auth contract, no new paths.
- **Frontend (`public/index.html`)**: digest cards now show provenance chips —
  repo pill, `▦ bucket` accent pill, `◈ ticket-title` pills (ellipsized,
  stage in the title attr) — and the tally is informational: word count pill +
  **non-info tags only** ("INFO ×18" is gone; a digest that's all info shows
  just its word count).
- **Block classification**: `responseToBlocks` now classifies each raw markdown
  line into the reader's existing vocabulary (decision/done/critical/high/info)
  via ordered regex rules, first match wins; past-tense accomplishment beats the
  brokenness it describes ("Fixed the broken sync" → done). Orb color, TOC
  prefixes, and HUD already keyed off these tags, so the reader got richer for
  free. Sanity check on the 2026-07-27 devlog: 53 info / 4 done / 4 high /
  4 critical / 1 decision, loud tags on genuinely loud lines.

## Verification

- `npm test` 32/32 green (digests-api grew meta round-trip + absent-meta cases;
  the in-memory Turso mock learned the meta column).
- Live prod check after `vercel --prod`: POST with meta → GET returns it
  verbatim → DELETE cleaned up; deployed HTML contains the new chip code.
- End-to-end CLI smoke on this session: bucket Focal auto-resolved; ticket
  list correctly empty after the tool-result exclusion fix.

Nothing committed — working tree only, per house rules.
