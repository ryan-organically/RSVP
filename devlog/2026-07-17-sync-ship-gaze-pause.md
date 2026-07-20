# Shipped cloud sync + settings accent row; built gaze pause (2026-07-17)

## Pushed to main and live on focal.wiki (a2874a5..8d2db84, first push in 38 days)

- Proxy hardening: timeout, 3x retry/backoff, better edge caching (`api/proxy.js`, `vercel.json`).
- The full opt-in cloud sync feature that had sat uncommitted since late June: `api/digests.js` + `api/books.js` (SYNC_TOKEN bearer auth, timingSafeEqual, SHA-256 token-hash owner namespacing), zero-dep `lib/turso.js`, CLI `--last`/`--sync`, reader sync UI, 29 passing tests. Docs reconciled: CLAUDE.md/README no longer claim "there is no cloud sync"; the key rule now codifies the opt-in pattern and bans unauthenticated reads (the old pre-rewrite backend was removed for exactly that leak).
- CLI papercut fixed: `git rev-parse` stderr no longer leaks ("fatal: not a git repository") when digesting from a non-repo directory (3 call sites).
- Reader: accent color row (including red) added to the reading-settings popover, active-state synced with the top-nav picker. Verified live on production.

Sync stays dormant in prod until `TURSO_URL`, `TURSO_AUTH_TOKEN`, `SYNC_TOKEN` are set in the Vercel project (see DIGEST_WORKFLOW.md).

## Built, uncommitted: gaze pause (camera attention detection)

Opt-in checkbox in reading settings. Look away ~1s -> auto-pause with toast; look back ~0.5s -> resume via the 3-2-1 countdown. MediaPipe BlazeFace loaded on demand (pdf.js pattern), 4 fps on a 320x240 stream, head-turn heuristic (nose offset vs ear span), all on-device. Camera never starts at page load, releases after ~20s of non-reading, and degrades gracefully on permission denial or detector failure. Manual pause clears the auto-resume flag. Needs a real-browser camera sanity check before pushing; headless could only verify parse + wiring.

## Still parked (deliberate)

`public/home.html` marketplace-pivot landing (11/15 iterations), `public/takes/`, `social/` preset tweaks. The home.html pivot is a positioning decision for Ryan, not a code task. Also: check focal.wiki auto-renew before 2027-06-09.
