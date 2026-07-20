# Focal homepage — overbuild loop

Goal: a sweeping, high-fidelity marketing homepage that positions Focal as an **enterprise
reading marketplace** — a bookstore where authors advertise & sell, and a licensable RSVP API
anyone can embed. Fidelity bar: dev/malleable's static homepage. "Impressive technology only.
Rather overbuild." A *different take* (not a malleable clone).

Built as a standalone `public/home.html` so the working reader app (`public/index.html`) is
untouched while we iterate. Routing flip (make it `/`) is a later, deliberate step.

## Signature idea
Focal's own mechanic — RSVP word-flash with the red ORP letter — IS the hero. The homepage
speed-reads itself. The product demos live, above the fold.

## Aesthetic (different from malleable's orange-swiss)
Editorial-optical. Near-black warm ink, cream text, amber focal accent, ember ORP red, iris
cool accent for API/tech. Fraunces (variable display serif) + Space Grotesk (UI) + JetBrains Mono.

## Backlog (one shippable slice per iteration)
- [x] iter 1 — scaffold: nav, LIVE-RSVP hero + aurora bg + grain, marketplace grid (tilt), API
       section (typing code), footer wordmark (cursor-repel), scroll reveals, reduced-motion guard
- [x] iter 2 — pricing tiers (Reader/Author/Publisher/Enterprise) with billing toggle
- [x] iter 3 — interactive: a real embeddable RSVP widget the visitor can play (paste/sample,
       WPM slider, play/pause, progress rail, ORP-aligned word stage) — section #try, nav link added
- [x] iter 4 — enterprise social-proof (#enterprise): seamless hover-pausable logo marquee (8 brands,
       inline-SVG glyphs), featured testimonial card w/ avatar, animated stat band (reuses countUp)
- [x] iter 5 — polish: real mobile nav (hamburger→full-screen serif slide-in, Esc/link close, focus
       trap-ish + body lock, ?menu screenshot hook), :focus-visible rings everywhere, skip-to-content
       link, OG/Twitter meta, SVG favicon (amber ring + ember ORP dot), theme-color, canonical

## Overbuild backlog (post-polish — keep shipping one slice per iter)
- [x] iter 6 — interactive reading-speed calculator (#calc): 3 custom-styled range sliders (hrs/week,
       current wpm, Focal wpm) → live books/year now vs Focal + delta + comparison bars; computes on load
- [x] iter 7 — "how ORP works" explainer (#how): pivot-axis scope diagram, 5 example words flex-aligned
       so every ORP letter lands on one red vertical crosshair; active row cycles like the reader; 3 points
- [x] iter 8 — comparison table (#compare): semantic <table> Focal vs Traditional vs Audiobooks, 8 rows
       (speed, saccades, silent, re-read, retention, finish-rate, API, price); amber featured Focal column
       w/ "Most efficient" badge; horizontal-scroll wrap on mobile; ✓/✕/— glyph cells
- [x] iter 9 — FAQ accordion (#faq): 6 a11y disclosure rows (<button> aria-expanded + aria-controls,
       role=region panels), animated max-height, rotating chevron, first item open by default; ?still opens
       first two. NOTE: page is now ~9000px tall — screenshot with --window-size=1440,10000+
- [x] iter 10 — closing CTA band (between §faq + footer): amber arrival glow, mini live-RSVP reticle echo,
       "The whole library, at the speed of thought.", primary+ghost CTAs, micro trust row

## Round 2 overbuild backlog (keep shipping — "loop until pulled out")
- [x] iter 11 — three-audience selector (#who, after §market): a11y tablist (role=tab/tabpanel, aria-selected,
       roving tabindex, Arrow/Home/End keys, hidden panels) — Readers (reticle+stats vis), Authors (revenue
       card w/ sparkline), Developers (mini embed code); first tab active for ?still
- [ ] iter 12 — press/quotes strip ("As featured in" wordmarks) or live activity ticker
- [ ] iter 13 — animated reader globe / world map of readers
- [ ] iter 14 — changelog / "what's new" teaser card
- [ ] iter 15 — pass: cross-section motion choreography + perf audit + final QA sweep

## Gate
Headless Chrome screenshot renders with no console errors; self-assess fidelity each pass.
