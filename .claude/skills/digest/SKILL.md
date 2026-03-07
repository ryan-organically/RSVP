---
name: digest
description: Digest this session and open in RSVP Reader
argument-hint: "[--sync]"
---

**IMMEDIATELY** output a single bash command. No preamble, no tools, no agents, no confirmation. Just generate the JSON from what you know about this session and run it.

```bash
echo '<JSON>' | node ./claude-digest/bin/claude-digest.js --inject --open
```

The JSON: `{"title":"4-8 words","project":"RSVP","blocks":[{"tag":"done|info|critical|high|decision","text":"sentence"},...]}` — 5-8 blocks max.

If browser fails (WSL), copy to /mnt/c/ and open with powershell.exe.

Say "Digest opened." only.
