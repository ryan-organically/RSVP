---
name: digest
description: Digest this session and open in RSVP Reader
argument-hint: "[--sync]"
---

**IMMEDIATELY** output a single bash command. No preamble, no tools, no agents, no confirmation. Just generate the JSON from what you know about this session and run it.

```bash
echo '<JSON>' | node ./claude-digest/bin/claude-digest.js --inject --open --sync
```

The JSON: `{"title":"4-8 words","project":"RSVP","blocks":[{"tag":"done|info|critical|high|decision","text":"sentence"},...]}` — 5-8 blocks max.

`--sync` pushes the digest into your private cloud dev digests so it follows you to your phone for nighttime review. It is on by default here and **silently skipped when `$SYNC_TOKEN` is not exported** — no token, nothing leaves the machine (local-first). Drop the `--sync` flag from the command to force local-only.

`--open` uses the default browser (full tab). On WSL it copies to /mnt/c/ and opens with
powershell.exe. The experimental `--mini` app window is BROKEN/UNPROVEN — don't use it.

Say "Digest opened." only — add "Synced to your dev digests." if the CLI reported a sync.
