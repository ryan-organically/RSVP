---
name: digest
description: Generate a Dev Digest summary of the current Claude Code session and open in RSVP Reader
argument-hint: "[--sync] [--format json|markdown|html] [--output path]"
---

**IMPORTANT:** Do NOT ask the user to confirm or select a session. Execute immediately with no preamble.

## Steps

1. **Summarize this session** — Review the full conversation so far and produce a JSON digest object. Do this using your own reasoning, NOT by calling the Anthropic API.

2. **Output valid JSON** with this exact structure:
```json
{"title": "Short 4-8 word title", "project": "project-name", "blocks": [{"tag": "done|critical|high|info|decision", "text": "One concise sentence per block"}]}
```

Block rules:
- Each block: ONE sentence, 15-30 words, specific file names/numbers/details
- Tags: `critical` (bugs, security), `high` (warnings, perf), `done` (completed work), `info` (context, observations), `decision` (decisions made/needed)
- Order: critical first, then high, done, info, decision
- 8-20 blocks depending on session length

3. **Pipe the JSON into the CLI** to format and open in the RSVP Reader:

```bash
echo '<YOUR_JSON>' | node ./claude-digest/bin/claude-digest.js --inject --open
```

If `--format` or `--output` was specified in $ARGUMENTS, pass those instead of `--open`:
```bash
echo '<YOUR_JSON>' | node ./claude-digest/bin/claude-digest.js --inject $ARGUMENTS
```
