# Design Take Contract

You are building one of 10 alternate skins for the RSVP Reader app. The JS engine and the design switcher are already extracted into shared files. Your job is to produce ONE complete, self-contained HTML file that wires the working app into a new visual skin.

## Output

Write your skin to: `public/_takes/take-NN.html` (your assigned NN).

The file MUST contain — in order:

1. `<!DOCTYPE html>` and `<html lang="en">` open
2. `<head>` with charset, viewport, title, fonts (your choice), and a `<style>` block containing your full skin CSS
3. `<body>` containing all the required DOM nodes (see Required DOM below)
4. `<script src="_app.js"></script>` — loads the working app engine
5. `<script src="_switcher.js" defer></script>` — the bottom-right design switcher (do NOT customize, it self-renders)
6. `</body></html>`

The file is one self-contained HTML document. Do NOT split into separate CSS files. Do NOT load the original `index.html`.

## Hard constraints — DO NOT break these

1. **Every `id="..."` from the reference body must exist in your skin** with the SAME id and the SAME semantic role (button → button, input → input, div container → div). You can wrap, reorder, restyle, hide-by-CSS, or rename classes freely, but the JS pokes these IDs with `getElementById` so they must be in the DOM.

2. **Every inline `onclick="..."` handler from the reference must be preserved verbatim** on the equivalent element. The JS exposes functions like `switchTab('mybooks')`, `goToLibrary()`, `toggleTocSidebar()`, `addBookmark()`, `skip(n)`, `handleFile(event)`, `importPaste()`, `filterLibrary(this.value)`, `searchGutenberg()`, `submitPastedDigest()`, `setAccent('#hex')`, `toggleTheme()`. Keep them on the equivalent buttons/inputs.

3. **The `.view` / `.view.active` pattern must work.** The JS does `document.getElementById('libraryView').classList.remove('active')` and `document.getElementById('readerView').classList.add('active')` to swap views. Your CSS must implement `.view { display: none }` and `.view.active { display: flex/block/grid }` (your choice). Both `#libraryView` and `#readerView` must be top-level siblings inside body.

4. **The `.hidden` utility class must hide elements.** Style `.hidden { display: none !important }` (or equivalent).

5. **The `.light` body class is the light theme toggle.** Your CSS should define both dark (default) and light modes — `body.light { ... }` overrides. `toggleTheme()` toggles this class.

6. **The accent picker dots use `.accent-dot.active` to mark the current accent.** Your CSS must implement an `.active` state on accent dots. The `setAccent('#hex')` function updates a CSS variable `--accent` on `:root`, so design with `var(--accent)` for primary highlights.

7. **The play button changes between ▶ and ❚❚.** The JS sets `playBtn.textContent` directly. Keep `#playBtn` as a real button with no nested icon markup that the text would overwrite badly. Same for `#themeFab1`, `#themeFab2`, `#bmHeaderBtn`.

8. **`#wordDisplay` is where the speed-reading word renders.** It receives innerHTML with an `<span class="orp">…</span>` highlight. Style `.orp` to highlight the ORP letter (color/weight). The font for the word should be readable; the original uses a serif. Choose what fits your skin but make sure it's legible at 64px default font-size.

9. **`#progressFill` is animated via `transform: scaleX(...)`.** It must be a child of `#progressBar` and styled to fill horizontally with `transform-origin: left`.

10. **`#wpmSlider` is `<input type="range">`** — style it but keep it as a range input. `#fontSlider` same.

11. **Reader view layout:** It needs to be a full-viewport flex/grid with `#wordArea` taking the bulk, `#controlStrip` at bottom, and `#tocSidebar` either drawer-style or pinned-left. The JS controls open/close of `#tocSidebar` and `#settingsPopover` via `.open` / `.hidden`. The minimap (`#minimap`) can be hidden in your design (`display:none`) if you want — it's not required, just leave the elements in the DOM.

12. **Keep all default values:** wpmSlider defaults to value 300, fontSlider to 64, accelTarget input value 600. Don't change these defaults.

## Required DOM (must all be present, see `_body-reference.html` for exact markup)

Library view (`#libraryView.view`):
- `#tabMyBooks`, `#tabFree`, `#tabDigest` — three tab buttons with `onclick="switchTab('mybooks'|'free'|'digest')"`
- `#panelMyBooks`, `#panelFree`, `#panelDigest` — three panel divs; non-active ones get `.hidden`
- `#fileInput` (file input), `#pasteArea` (textarea), `#pasteBtn`, `#libFilter` (text input), `#bookList`
- `#gutenSearch`, `#gutenResults`, `#gutenFeatured`
- `#digestPasteText` (textarea), `#digestList`
- `#accentPicker` containing 6 `.accent-dot` buttons (first is `.active`) plus `#accentCustom` wrapping `<input type="color" id="accentColorInput">`
- `#themeFab1` button

Reader view (`#readerView.view`):
- Top bar with: back button (`onclick="goToLibrary()"`), `#currentChapter`, `#readerBookTitle`, settings toggle button (toggles `#settingsPopover.hidden`), `#bmHeaderBtn`, `#themeFab2`
- `#tocToggle`, `#tocOverlay`, `#tocSidebar` containing `#tocCount`, `#tocList`, `#bookmarkList`, and an `.btn-bookmark` "+ Add bookmark here" button
- `#wordArea` containing `#blockIndicator`, `#wordDisplay`, `#keyhint`, `#blockLabel`
- `#controlStrip` containing `#progressBar > #progressFill`, `#wordCount`, `#skipBack10`, `#playBtn`, `#skipFwd10`, two `onclick="skip(-50|50)"` buttons, `#wpmLabel`, `#wpmSlider`
- `#settingsPopover.hidden` containing `#fontSlider`, `#accelCheck`, `#accelTarget`, `#ttsCheck`, `#ttsVoiceRow.hidden`, `#ttsVoice`
- `#minimap` containing `#minimapCanvas` and `#minimapViewport` (can be hidden in CSS)

Globals (outside views):
- `#toast` (toast notification slot)
- `#loadingOverlay.hidden` containing `.spinner`, `#loadingMsg`, `#loadingProgress`

## How to start

1. Read `public/_takes/_body-reference.html` — that's the exact original markup with every ID, class, and onclick. Use it as your source of truth.
2. Restyle and restructure as your design direction demands, but never drop an ID, class JS references, or onclick handler.
3. Test mentally: when JS does `document.getElementById('playBtn').textContent = '❚❚'`, does your markup support that? When it does `tocSidebar.classList.add('open')`, does your CSS reveal the sidebar?

## What "wired" means

When opened in a browser, your take must:
- Show the library with 3 tabs that switch panels
- Let user click a book in the list (rendered by JS) and enter reader view
- Play/pause via space bar or `#playBtn`
- Show a word highlighted with ORP in `#wordDisplay`
- Advance `#progressFill` as words tick
- Have a visible bottom-right design switcher (from `_switcher.js`)

If your skin breaks any of those, it fails the contract.
