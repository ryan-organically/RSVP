# 2026-07-27 — Mini window, one-tap connect, auto-digest hook

## Why the phone never showed digests (diagnosis)

The whole sync pipeline was already working: `SYNC_TOKEN` exported in `~/.bashrc`, the CLI
pushing by default, `focal.wiki/api/digests` returning HTTP 200 with 49 stored digests
(2026-07-02 → 2026-07-21, across born-again, qa, organically, roanoke-sandbox, signet,
blender-bridge, malleable…), and the deployed frontend matching local. The only missing
link was device onboarding: the phone's browser had never had the token pasted into the
Dev Digest sync box, so `pullRemoteDigests` never ran there. Typing a 64-char hex token on
a phone keyboard is the step that silently never happens.

## Fixes shipped (deployed to focal.wiki via `vercel --prod`)

1. **`#connect=<token>` deep link** (`public/index.html` init): stores the token, scrubs it
   from the URL/history via `replaceState` (fragment never reaches the server), switches to
   the Dev Digest tab, pulls digests + books, toasts. Accepts `#sync=` too.
2. **Onboarding delivery:** Taildropped a tiny HTML page with the connect link to
   `iphone-12-pro-max` (meta-refresh + tap link). Also wrote
   `~/.config/claude-digest/config.json` → `{"taildrop": "iphone-12-pro-max"}` so `--phone`
   works with no env var.

## CLI: mini window (`claude-digest/bin/claude-digest.js`)

- `--open` now launches a chromeless **500x500 app window pinned bottom-right** of the
  primary work area (16px margin): Edge/Chrome `--app` mode with `--window-size/-position`
  and a dedicated `--user-data-dir=C:\temp-digest-profile` (geometry flags are ignored when
  reusing a running instance — the separate profile forces a fresh one). Work area probed
  via `execFileSync('powershell.exe', …)` — NOT `execSync`, whose `/bin/sh` layer eats `$wa`.
- `--full` restores the old full-browser-tab behavior. Non-WSL Linux gets the same app-mode
  treatment when a Chromium browser is on PATH.
- True glassmorphic/acrylic transparency isn't reachable from a browser window; a native
  WebView2 host would be the next step if the app-mode window isn't glassy enough.
- **Single-window policy (post-ship fix):** launching against a live temp-digest-profile
  instance just forwards the URL to it — geometry flags ignored, and the new window opens
  on whatever *virtual desktop* the first instance lives on, so windows piled up out of
  reach (Ryan hit exactly this: 3 taskbar Edges on another desktop). Now every open first
  kills the previous profile's browser processes (`Get-CimInstance` filtered to
  msedge/chrome by name — a bare CommandLine match would catch the querying powershell
  itself), then launches fresh: one window, correct position, current desktop.
  `--hide-crash-restore-bubble --disable-session-crashed-bubble` suppress the restore
  nag the force-kill would otherwise cause.
- **VERDICT (end of session): mini window is BROKEN/UNPROVEN — demoted to opt-in.** Even
  after the single-window fix, Ryan still couldn't see the window on his screen. `--open`
  is back to the proven default-browser flow on every platform; the mini window now
  requires an explicit `--mini` (and `--full` is a harmless no-op). Root cause not yet
  found — suspects: virtual-desktop placement of detached WSL-spawned processes, DPI/
  multi-monitor coordinate mismatch, or Edge profile window-state restore. Next attempt
  should try launching via `wt.exe`/`explorer.exe` on the active desktop, verifying
  coordinates with `Get-Process | % MainWindowHandle` + `GetWindowRect`, or a WebView2
  host app. Do not flip the default back until a window has been SEEN on screen.

## CLI: `--transcript <path>` + `--exact`

`parseLastResponse` intentionally falls back to an earlier long response when the last one
is short — right for manual `/digest`, wrong for automation (every "Done." would re-digest
the previous long answer). `--exact` returns the literal final response; `--transcript`
pins the exact session file instead of guessing via `findCurrentTranscript()`.

## Auto-digest Stop hook (global, `~/.claude/settings.json`)

`~/.claude/hooks/auto-digest.mjs`: on every Stop, parses the transcript (`exact` mode),
counts words, and if > 500 spawns `claude-digest --last --exact --transcript <path> --open`
detached. Dedupes via content-hash state file (`~/.claude/hooks/.state/auto-digest-last`)
because Stop also fires on resume/clear/compact. Async, never blocks, always exits 0.
Tested both branches with a real short-response transcript (no-op) and a synthetic
600-word transcript (window opened, hash recorded); the junk test digest was deleted from
the cloud afterwards.

## Security review

Full report in `notes/security-review-2026-07-27.md` (gitignored — public repo). Headline:
the CLAUDE.md security contract is correctly implemented end-to-end; one medium finding
(missing CSP / X-Frame-Options / HSTS headers in `vercel.json`) and a few lows, none
applied yet — awaiting Ryan's call.

## Tests

`npm test` green: 13 + 5 (books/digests API mocks, CLI sync) after all CLI changes.
Nothing committed — working tree only, per house rules.
