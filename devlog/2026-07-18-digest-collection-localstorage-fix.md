# 2026-07-18 Digest collection localStorage key fix

Ryan: "make sure collections of digests are stored in localstorage or actual
storage in my focal.wiki."

## The bug

The claude-digest CLI (`--open`) generates a standalone RSVP reader HTML with
the digest injected and a small persistence script appended. That script wrote
the digest to localStorage key **`localDigests`** (legacy, cap 50):

```js
const stored = JSON.parse(localStorage.getItem('localDigests') || '[]');
```

But the reader app's canonical digest collection lives under **`rsvp:digests`**
(`K.digests`, cap 100). `getDigests()` reads `rsvp:digests` first and only
falls back to `localDigests` when the canonical key is *absent*:

```js
function getDigests() {
  let d = LS.get(K.digests, null);           // rsvp:digests
  if (!Array.isArray(d)) { const old = LS.get('localDigests', null); ... }
  return d;
}
```

So once the app had ever written its own `rsvp:digests` store (i.e. after the
first normal use), every digest opened via the CLI was written to a key the
app no longer reads. The collection silently stopped accumulating CLI digests.

## The fix

`claude-digest/src/formats/rsvp.js` — the injected persistence block now writes
the app's canonical key, format, and cap:

```js
const KEY = 'rsvp:digests';
let stored = [];
try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v)) stored = v; } catch {}
if (!stored.some(s => s && s.id === _injectedDigest.id)) {
  stored.unshift(_injectedDigest);
  localStorage.setItem(KEY, JSON.stringify(stored.slice(0, 100)));
}
```

Now a CLI-opened digest lands in the same collection the app renders, newest
first, deduped by id, capped at 100 to match `setDigests`.

## focal.wiki (cloud) path: already correct

The other half of Ryan's ask (actual storage in focal.wiki) was already wired
and left intact:

- CLI `--sync` -> `syncDigest()` POSTs the session to `/api/digests`.
- `api/digests.js` upserts into Turso, namespaced by a hash of the SYNC_TOKEN.
- The reader's `pushDigest` / `pullRemoteDigests` mirror + merge across devices.

So collections persist in two places: the browser's `rsvp:digests` localStorage
(now correct from the CLI too) and, when a SYNC_TOKEN is set, Turso via
focal.wiki. Requires `export SYNC_TOKEN=...` where the CLI runs (DIGEST_WORKFLOW
step 2) for the cloud push.

## Notes / scope

- `public/takes/app.js` (a separate design prototype) still uses `localDigests`.
  Left untouched: it is not the canonical reader.
- Caveat on the CLI-opened page: it opens as a `file://` (or `/mnt/c/…`) temp
  file whose localStorage origin does not share with hosted focal.wiki, so the
  reliable cross-device path remains the Turso/`--sync` one. The key fix still
  matters for the hosted app and any same-origin dev-server open.

## Verify

`npm test` (RSVP): 11 + 13 + 5 passed, 0 failed (books-api, digests-api,
cli-sync incl. "injected HTML id === synced id"). Not committed.
