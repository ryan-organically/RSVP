# 2026-06-09 — Focal rebrand, SEO, reader mechanics, Gutenberg search fix

Session driven via Remote Control. Three threads, all shipped except the domain attach (waiting on Ryan to buy).

## 1. Gutenberg "search failed" fix (committed 43a2e76, 347b46c)
Root cause: catalog search hit `gutendex.com` directly from the browser with no timeout/retry/fallback. gutendex was fully down (HTTP 000). Also silently broke featured downloads and re-downloads (they looked up formats by id on gutendex too).

Fix in `public/index.html`:
- Search: try gutendex on a 7s timeout, then fall back to gutenberg.org OPDS search (`/ebooks/search.opds/?query=`) through the existing `/api/proxy` (retry + edge cache). Parse Atom with `DOMParser` + `getElementsByTagNameNS('*', ...)` (Safari-safe).
- Featured + re-download build the text URL directly from the ebook id (`gutenTextUrl(id)` = `cache/epub/{id}/pg{id}.txt`), dropping the gutendex dependency.
- Sanitized user-facing download errors (no more "Proxy error 404" / "run vercel dev" leaking to toasts); technical detail goes to `console.warn`.

## 2. Rebrand RSVP Reader -> Focal + SEO (committed 3c353db)
- Product name is now "Focal"; RSVP kept as the *method* (Rapid Serial Visual Presentation) everywhere it is explained. GitHub repo URLs still say `ryan-organically/RSVP` (repo not renamed).
- New `<head>`: title, 156-char meta description, canonical, full OG + Twitter cards, JSON-LD WebApplication. All point at `https://focal.wiki`.
- Single H1 (demoted "Your library" to H2, updated `.lib-header h1` -> `h2` CSS).
- New `public/sitemap.xml`, `public/robots.txt`, generated `public/og-image.png` (1200x630, PIL/DejaVu), manifest name + icon glyph R->F, service-worker cache `rsvp-v4` -> `focal-v5`.
- Removed all stylistic em dashes from copy/comments; KEPT two functional U+2014 uses (PUNCT timing-data key, chapter-detect regex).

## 3. Reader mechanics (in 3c353db)
- `calcORP` returns `Math.floor((len-1)/2)` -> highlighted char is the exact word center (odd = dead center, even = left-of-center).
- `wordDelay` adds `countSyllables`-based factor: >=3 syllables get `1 + min(syl-2,4)*0.09` longer flash, combined via Math.max with punctuation/length.
- Chapter pause: `S.chapterStarts` (Set from `detectChapters`, index>0); scheduleTick adds +1200ms at a chapter start (vs +500ms paragraph). ALWAYS on (not gated by smartPause); null in digest mode.
- Bionic ("bold") mode now bolds the center char: word-display gets a `bionic` class, `.word-display.bionic .orp{font-weight:var(--w-bold)}`.
- Removed the top `.orp-guide` tick (DOM + CSS); lower guide kept.

## 4. Top nav overflow + accent popover fix (committed df2829d)
Reported: "icons like the light mode are escaping" the top nav. Root-caused with headless Chromium (playwright-core driving the cached browser at 5 widths):
- Constant +16px horizontal overflow at every width. Cause: `.lp-hero` used `margin: -16px -16px ...` to full-bleed, but `#libraryView` has no horizontal padding, so it bled 16px past the viewport. `body{overflow-x:hidden}` was clipping (not fixing) it, and on Safari the right-edge nav icons fell into the clipped strip. Fix: removed the horizontal bleed (`margin: -16px 0 var(--s-12)`).
- Accent popover (`.accent-pop`, absolute) anchored to the viewport because `.util-row` was `position:static`; detached from its button above 920px. Fix: `.util-row{position:relative;z-index:2}`.
- Bumped nav height 56->60 (mobile 52->56) per request.
- Verified: scrollWidth === clientWidth at 390/768/834/1024/1366; popover anchored under button; screenshots clean. Reader-bar was already fine (title truncates), left alone.
- Repro harness: playwright-core in /tmp/pw driving `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome` against a local server. Handy for future visual/layout debugging.

## Infra notes
- The Vercel project `rsvp-reader` was NOT git-connected; I ran `vercel git connect` so pushes to `main` now auto-deploy. Team `team_ZAESzFxWdhPJ30UfV7L8jgLY`.
- Domain: `focal.wiki` is available, $2.99 first year, $28.75/yr renewal via Vercel. Purchase is interactive (no `--yes` flag, expect not installed), so Ryan runs `vercel domains buy focal.wiki` himself; then attach with `vercel domains add focal.wiki rsvp-reader`. Until attached, the focal.wiki OG/canonical/sitemap URLs 404 (expected); the app is live at `rsvp-reader-ecru.vercel.app`.

## Done: focal.wiki live
- Registered via Vercel UI (CLI buy needs ICANN contact info we did not have, so Ryan bought it in the dashboard). Attached to rsvp-reader via the REST API (`POST /v10/projects/rsvp-reader/domains`), apex `focal.wiki` + `www.focal.wiki` -> apex 308 redirect, both verified, HTTPS auto-provisioned, serving the app. Renewal $28.75/yr on 2027-06-09 (check auto-renew toggle in Vercel domain settings).

## Still pending
- Other uncommitted working-tree changes left untouched: `api/proxy.js` (resilience), `vercel.json`, `social/*`, `.gitignore`, `notes/`, `public/takes/`.
