# Share surfaces: links, digest links, standalone HTML from the reader

2026-08-20. The reader can now hand things out, not just take them in: share a
book or a digest as a link, copy an iframe embed snippet, or download a
self-contained HTML file — all from inside the app, all without the text
touching a server.

## What shipped

**Share sheet** (`openShareSheet` in `public/index.html`) — one modal serving
every surface. Shows the fragment link with a Copy button, a native `Share…`
button where `navigator.share` exists (phones), `Copy embed code` (an iframe
snippet pointing at the link plus `&embed=1`, riding the minimal-chrome mode),
and `⤓ Standalone HTML`. When a text is too big for a link the sheet says so
and offers the file path only.

**Link building in the reader** — `buildShareLink(kind, payload, title)`:
deflate-raw + base64url, `location.origin`, same encoding and same 180k cap as
`embed.js` and `@focal/mcp` produce. The reader previously could only *decode*
fragments; now it can mint them.

**`#d=` fragment — digests with their tags intact.** A digest flattened to
plain text loses its CRITICAL/HIGH/DONE structure, so digest shares carry
compressed JSON (`{title, project, blocks}`) instead. `openFromFragment()`
gained the `d` branch: payload is treated as untrusted — tags whitelisted
against the known five, strings clamped, structure rebuilt field by field
(never `Object`-spread, so no prototype-key tricks) — then lands in the
recipient's digest list (deduped by content, mirrored via `pushDigest` like a
pasted digest) and opens straight into the reader. `#d=` joins the
handoff-suppression list in `init()` so it never fights the onboarding wizard.

**Standalone HTML for books.** `exportDigest`'s self-contained player was
refactored into `standaloneFocalHtml(title, blocks)`; `exportBookHtml(id)`
feeds it a book's paragraphs as uniform `info` blocks, and the player drops
the digest chrome (tag indicator, block-boundary pause) when every block is
plain. One file, zero dependencies, opens from a `file://` double-click.

**Entry points:** ⇗ button in the reader top bar (`shareCurrent()`, routes to
book or digest), `Share…` in the library row menu, `⇗ Share` on each digest
card, and `Share this` in the command palette while reading.

## The rule that held

Nothing new touches the server. Links carry the text in the fragment (browsers
never transmit it), the standalone file is generated in-browser, and the embed
snippet is just markup around the link. The digests/books sync API is
untouched.

## Tests

`embed-e2e.test.mjs` went from 22 to 43 assertions in real Chromium. Also
updated its first section for the in-flight overlay work (found uncommitted in
the working tree: embed.js v1.1.0 opens the reader in an in-page iframe
overlay instead of a new tab — the old test waited for a popup that never
comes; it now asserts against the overlay iframe, its `src` fragment, the
`body.embed` class, and Escape-to-close). New sections prove: a link built by
`shareBook` imports on a fresh browser profile that has never seen the text,
and a `#d=` link lands a digest with tags surviving, unknown tags degrading to
`info`, no book-library pollution, and no duplicate on second open. `npm test`
121 assertions green, `npm run test:e2e` 43 green.

## Notes

- Share links for URL-sourced books send the *text*, not the URL — the source
  URL isn't stored in library metadata (only `gutenId` is). Storing source
  URLs and preferring a `#u=` link when one exists would make smaller links
  for articles; not built.
- The welcome book and Gutenberg texts are public-domain; sharing anything
  else is the sharer's judgment, same as any copy-paste.
