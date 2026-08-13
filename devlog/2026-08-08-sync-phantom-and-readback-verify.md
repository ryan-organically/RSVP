# Phantom sync caught; read-back verification added

2026-08-08. Status: **PROVEN** (Focal board ticket `5b1b6635`, closed 08-09).
Ryan read the probe row on his phone, remotely, with no QR scan — computer
push → server → phone read, one account fingerprint end to end. The phantom
sync below was the only real defect; read-back verification now guards it.

## What happened

A `/digest --sync` run printed `Synced to https://focal.wiki/api/digests`, but
the digest never appeared in the server's read-back list, and the phone showed
nothing. The old success message trusted the POST's HTTP status alone; a 2xx
with no durable row produced a silent, confident lie. Separately probed the
API by hand (POST then GET): the endpoint and this machine's credential are
healthy — a probe row landed and read back fine — so the phantom is
intermittent, not systemic.

## The fix (CLI, shipped)

`syncDigest()` in `claude-digest/bin/claude-digest.js` now:

1. POSTs as before; a non-2xx prints `SYNC FAILED (push)`.
2. **GETs the list back and requires the pushed id to be present** before
   claiming success: `VERIFIED by read-back`.
3. If the push was accepted but the id is missing: `SYNC FAILED (phantom)` —
   the exact failure that used to pass silently.
4. Every line carries an **account fingerprint**: first 8 hex chars of
   sha256(token). Same derivation as the server's owner namespace, safe to
   print, never the token. Two devices showing the same fingerprint are
   provably the same account; differing fingerprints explain "my digests
   aren't on my phone" instantly.

## Remaining design (ticketed, not built)

- **Reader UI fingerprint**: the Dev Digest tab should display the same
  8-char fingerprint next to its connect state so a phone can be compared
  against the CLI line at a glance.
- **Tailnet leg**: focal.wiki is a public Vercel app, so tailnet membership
  can't authenticate it (motherboard doctrine); the tailnet rail here is
  Taildrop (`--phone`, already built) as the no-server fallback, not a
  replacement for the token account.
- **Phone diagnostic**: two verified rows are live server-side ("Transfer
  probe" + tonight's digest). If the phone's Dev Digest tab shows them, the
  pipe is proven and the phantom was the only bug; if not, the phone's stored
  token mismatches and needs a one-time reconnect.
