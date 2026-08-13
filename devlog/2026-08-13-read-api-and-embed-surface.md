# /api/read + the embed surface

2026-08-13. Distribution infrastructure: the first two pieces that let Focal be
installed somewhere other than focal.wiki.

Context: the strategy work behind this (50 distribution channels, the acquisition
plan, the full infra spec) lives in the gitignored `notes/` directory, not here.

## What shipped

**`lib/fetch-safe.js`** — SSRF-guarded outbound fetch, shared by the api functions.
`/api/read` takes a URL from an untrusted caller, which without guards is a
server-side request forgery primitive. Defence in depth, strongest first:

1. Host allowlist (this alone stops the class; everything else is backup).
2. https only, no credentials in the URL.
3. Every resolved address must be public — blocks loopback, RFC1918, CGNAT
   100.64/10 (tailnet lives there), link-local incl. the 169.254.169.254 metadata
   endpoint, multicast, and the v6 equivalents.
4. Redirects followed **manually**, re-validating 1-3 on every hop. `redirect:
   'follow'` would let an allowlisted host bounce us anywhere.
5. Byte cap enforced while streaming, not from `Content-Length` (upstream lies).

Residual risk, stated rather than hidden: between the DNS check and the socket
fetch actually opens, a hostile resolver could return a different address (DNS
rebinding). Node's fetch gives no way to pin the resolved IP. The allowlist is
what holds there — an attacker would need DNS control over a host we already
serve, at which point they own that source anyway.

**`lib/extract.js`** — dependency-free HTML → readable text. Readability-shaped
heuristic: strip furniture, score candidate containers by paragraph prose,
penalise link farms, flatten to paragraphs. No DOM, no npm tree, because it runs
both in a serverless function and (in a trimmed form) inside embed.js.

**`api/read.js`** — `GET /api/read?url=<https>&format=json|text`. Stores nothing,
authenticates nothing. Per-source adapters: arXiv (prefers the HTML rendering,
falls back to the Atom API for title/authors/abstract), Wikipedia (action API
`explaintext`, all languages incl. mobile hosts), Gutenberg/Standard Ebooks plain
text with `Title:`/`Author:` parsing, generic HTML for the rest.

**Fragment handoff in `public/index.html`** — `openFromFragment()` accepts
`#u=` (public URL via /api/read), `#t=` (deflate-raw base64url text), `#p=`
(uncompressed fallback), `#post=1` (text arrives by postMessage from the opener,
for texts too big for a URL). All ride the fragment, which browsers never transmit
to a server, so handed-over text stays on-device exactly like a local file import.
Same reasoning as the existing `#connect=` token handoff. The URL is scrubbed with
`history.replaceState` immediately on boot.

**`public/embed.js`** — 8.7KB raw, **3.4KB gzipped**, zero dependencies. One script
tag puts a "Read in Focal" button on any page. Extracts client-side, hands over by
fragment (or postMessage above 180KB of payload). No cookies, no storage on the
host domain, no network request until a visitor clicks.

**`public/embed.html`** — docs + live playground + the copy-paste snippet. This is
the page a bookstore or newsletter operator lands on.

## Measured, not assumed

Live smoke test against the real sources (all tests are mocked, so mocks prove the
guards, not the adapters):

| Source | Result |
|---|---|
| `en.wikipedia.org/wiki/Rapid_serial_visual_presentation` | 200, 471 words, 244ms |
| `arxiv.org/abs/1706.03762` (Attention Is All You Need) | 200, 5,646 words, 268ms, full HTML text |
| `gutenberg.org/cache/epub/2701/pg2701.txt` (Moby Dick) | 200, 215,845 words, 313ms |
| `standardebooks.org/ebooks/herman-melville/moby-dick` | 200, 525 words (see gap below) |
| `news.ycombinator.com` | 403, not on the allowlist |

## Tests

- `claude-digest/test/read-api.test.mjs` — 57 assertions, no network. Stubs both
  `globalThis.fetch` and `dns.promises.lookup`; an SSRF guard only exercised
  against the real internet is a guard nobody has checked. Covers every private
  range, redirect-off-allowlist (and asserts the off-allowlist URL was never
  fetched), https downgrade, redirect bounding, streamed and declared size caps,
  extraction, and each source adapter.
- `claude-digest/test/embed-e2e.test.mjs` — 22 assertions in real Chromium, run
  with `npm run test:e2e`. Serves `public/` itself and skips cleanly when
  Playwright is absent (it is not a dependency here). Proves the button appears on
  a foreign page, the text survives compression + fragment, the reader imports it,
  no cookies are set, no query string is ever produced, the postMessage path
  carries a 4,800-word text intact, and a malformed payload fails safely.

`npm test` is 95 assertions green; `npm run test:e2e` is 22 green.

## One thing fixed on the way past

`cli-sync.test.mjs` was red in the working tree (green at HEAD). Not a regression
in the feature: the 2026-08-08 read-back verification made the CLI do POST-then-GET,
and the test's mock server overwrote its single `received` record on every request,
so all the assertions were inspecting the GET. Rewrote it to record all requests,
return a real list from the read-back, and assert both halves — including a phantom
case where the server accepts the push but never lists the row, which must be
reported as `SYNC FAILED (phantom)` and not as success. That is the exact bug the
read-back was built for, and nothing was locking it in.

## Second pass: MCP server + metrics

**`mcp/` — `@focal/mcp`**, zero dependencies, raw JSON-RPC over stdio (no SDK). Two
tools:

- `focal_open {text, title?, wpm?, open?}` — compresses the text into a fragment
  link and opens it. This is the "long agent responses" thesis made real: any MCP
  host, not just Claude Code with a hand-installed skill.
- `focal_read_url {url, include_text?, max_chars?}` — calls `/api/read`. Returns
  metadata plus a link by default and the prose only on request, so an agent
  fetching a paper for a human does not burn its own context window on 200k words.

Two things worth remembering:

- **Never write to stdout except protocol messages.** A stray byte corrupts the
  whole session. The browser-open helper is wrapped so a spawn failure cannot leak.
- **The module must not start a server on import.** The first version did, and it
  ate the e2e test's stdin and killed the test process through `rl.on('close')`.
  The stdio loop now sits behind an `isMain` guard, which is also what lets the e2e
  test import `focalUrl` and prove an MCP-generated link really reads.

**Metrics — `lib/metrics.js` + `api/metrics.js`.** Deliberately *not* client
telemetry. No beacon, no visitor id, no session id, no IP, no user agent, no client
code that reports anything. The server counts requests it already served, bucketed
by day and one low-cardinality dimension (`/api/read` calls, by source), into integer
totals. There is no write route at all, so nobody can inflate the numbers; reads are
gated behind `SYNC_TOKEN`. Counting never throws and never blocks a response.

This is a smaller instrument than the acquisition plan assumes, and that is a real
trade-off rather than an oversight: **reader sessions remain unmeasured by design.**
Measuring them means a beacon from the app, which contradicts the promise printed on
the landing page and in `embed.html`. That is a values call, not an engineering one,
so it is Ryan's to make. The options, in order of my preference:

1. Leave it. Sell the API/route numbers plus embed-domain count, and treat "we don't
   track readers" as part of the pitch. Honest, and weakest on paper.
2. Settings toggle, default OFF, "share anonymous counts". Real numbers from the
   minority who opt in, extrapolated with an honest caveat.
3. Default ON with a first-run notice and a one-click off. Best numbers, and it
   spends the exact credibility the product is built on.

## Known gaps

- **Standard Ebooks** returns the ebook landing page (525 words), not the book
  text. Needs its own adapter pointing at the single-page HTML edition.
- **No rate limiting** on `/api/read`. Serverless has no shared state to count
  against; for now the allowlist plus long edge caching is the whole defence.
  Revisit if it gets abused.
- **No metrics anywhere.** Every traction number in the plan is still
  unmeasurable. That is the next build item, ahead of any further surfaces.
- `embed.js` auto-detection has not been tried against real CMS templates
  (WordPress, Shopify, Ghost). It works on hand-written article markup.
