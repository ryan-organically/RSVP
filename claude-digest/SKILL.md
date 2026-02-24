---
name: digest
description: Generate a Dev Digest summary of the current or most recent Claude Code session
argument-hint: "[--format json|markdown|html] [--output path]"
---

Generate a session digest by running the claude-digest CLI tool.

Run the tool against the most recent session transcript:

```bash
node /home/ryan-organically/dev/RSVP/claude-digest/bin/claude-digest.js --latest $ARGUMENTS
```

The output is an RSVP Reader-compatible digest with tagged blocks:
- **CRITICAL** (red): Bugs, breaking issues, security problems
- **HIGH** (orange): Warnings, performance issues, concerns
- **DONE** (green): Completed tasks, features, fixes
- **INFO** (blue): Context, architecture notes, observations
- **DECISION** (purple): Decisions made or needed

Formats: `--format json` (default), `--format markdown`, `--format html`
