# Confirm and prompt dialogs were dead on arrival: welcome read could not be deleted

Reported 2026-09-17: "can't delete welcome to focal". Reproduced headless with
Playwright against the deployed app on a fresh profile, desktop and iPhone 12
Pro Max emulation: row menu opens, Delete is there, the confirm modal shows,
tapping Delete leaves the row and the `rsvp:library` entry in place. No console
errors.

## Cause

`uiConfirm` and `uiPrompt` installed `_modalResolve = res` and THEN called
`openModalShell`, whose first line settles "any stale pending modal" by
resolving `_modalResolve` with `null`. So the dialog's own promise resolved
`null` on open; `confirmDelete` saw a falsy answer and returned before the
user touched anything. Measured: `uiConfirm()` resolved `null` while the
modal was still on screen; `confirmDelete` with the confirm stubbed to
`true` emptied the library correctly. Present since the June rewrite
(4483cfe), so every delete and rename in the library has been a no-op since
then. Not welcome-specific.

## Fix

Open the shell first, install the resolver second, in both functions
(`public/index.html`, six lines). Verified against a local static server:
cancel keeps the book, rename writes the new title, delete removes the row
and the entry survives a reload as gone, on both viewports. `npm test`
26/26. Deployed to focal.wiki with `vercel --prod`.

Also observed, not changed: the row's `⋯` button is `opacity:0` until
hover, so on a phone it is invisible until you know where to tap.
