# 2026-07-20 — `digest <path>` file mode + Taildrop phone delivery

Two additions to the claude-digest pipeline, both in `claude-digest/bin/claude-digest.js`.

## 1. Headless file mode: `digest <path>`

Replaces "cat a file in the terminal" with "speed-read it in RSVP", no Claude session needed.

- New `--file <path>` flag (bare positional also works). Reuses `responseToBlocks` (per-line
  markdown stripping, code fences skipped). Title = file basename, project = git repo of the
  file's directory, falling back to the parent dir name.
- Wrapper installed at `~/.local/bin/digest` (on PATH): `digest <path> [--sync] [--no-open]`.
  `--no-open` prints HTML to stdout instead of launching the browser; other flags pass through.

## 2. focal.wiki sync is now DEFAULT-ON (mobile delivery, revised same day)

First pass was automatic Taildrop to the phone (device-to-device, tokenless). Ryan
redirected: he wants digests in the **focal.wiki UI's Dev Digest tab**, not as files in
the Tailscale app. So:

- `syncDigest` now runs on **every** rendered digest — `/digest` (`--last`), `/diff`
  (`--inject`), and `digest <path>` (`--file`) — whenever `$SYNC_TOKEN` is in the env
  (it's exported in `~/.bashrc` since 2026-07-18). No token → silent skip (the "set
  $SYNC_TOKEN" warning only prints if `--sync` was passed explicitly), so the
  zero-credential local-first default is preserved for everyone else.
- New `--no-sync` flag skips one run; `--sync` is redundant but kept for compatibility
  (the /digest and /diff skills still pass it, harmless).
- Phone reading path: focal.wiki → Dev Digest tab, token connected once per device.

**Taildrop demoted to opt-in:** the `tailscale file cp` path from the first pass stays in
the CLI but only fires with an explicit `--phone` flag (device from `$DIGEST_TAILDROP` or
`~/.config/claude-digest/config.json` `{"taildrop": "<device>"}`). The auto-push config
file created earlier today was deleted. `--no-phone` was removed with the auto behavior.

Verified end-to-end: `digest ~/dev/CLAUDE.md --no-open` → `Synced to
https://focal.wiki/api/digests`, and a token-authed GET shows the digest row
(`"title":"CLAUDE.md","project":"dev"`) ready for the Dev Digest tab.

Docs updated: `DIGEST_WORKFLOW.md` (storage section says default-on, "Mobile access"
section, file-mode examples), `CLAUDE.md` (commands table row + sync paragraph). Not
committed yet.
