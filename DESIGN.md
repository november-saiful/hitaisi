# DESIGN.md — Hitaisi

Subject: a free benevolent commons. Audience: learners, sharers, volunteers.
Job of the homepage: show what was freely given this week, and where to give.

## Palette (R-01, R-29: 2 cores + 1 accent)
- `paper` #FBFAF7 — page base (light default; content-first product)
- `ink` #16130E — text
- `moss` #1B5E3B — the ONE accent. Used only at the key moment:
  primary publish/download CTA + active hub marker. Nowhere else.
- Supporting neutrals: `clay` #E9E2D5 (hairline/fill), `stone` #6B645A (secondary text)
- Dark theme: `night` #12100C base, `parchment` #EDE8DB text, same moss accent lightened.
- No blue-purple gradients, no rainbow, no neon, no radial orbs (R-01).

## Type (R-06)
- Display: Fraunces (serif, high contrast) — homepage thesis + knowledge headlines only.
- Body/UI: Plus Jakarta Sans — everything else.
- Data/mono: system mono for checksums, sizes, dates only.
- Reason: serif = editorial generosity; grotesk = utility clarity.

## Radii / elevation (R-10..R-13)
- Radii: card 18px, input 12px, primary CTA pill 999px, badge 8px. Never all-pills.
- Shadow: one resting shadow for the primary CTA card only. Everything else flat with 1px clay hairline.
- Glass: one element only — the floating hub switcher on scroll. Everything else solid.
- Glow: none.

## Rhythm dial: 3 (sections visibly vary per hub)
- Knowledge: editorial split (essay left, TOC/related right).
- Software: store rows, not cards-grid.
- Files: dense decision table.
- Services: directory + 3-step request strip (need → match → confirm — the real process).
- Social: feed + event rail.
- No bento mosaic, no fake terminal, no logo bar, no 3-step "how it works" icon row, no invented stats (R-05, C-3).

## Motion dial: 2 (purposeful reveals + hover micro-interactions, no loops)
- Entry: fade-up 24px + de-blur 600ms `cubic-bezier(0.32,0.72,0,1)`, `whileInView` once.
- Hover: CTA inner icon translates diagonally; cards lift 2px max.
- No endless pulse/float/spin (R-19). `prefers-reduced-motion` disables all.

## Signature: the Giving Ribbon
One continuous 2px moss thread runs down the left of each hub timeline —
chapter marks (Knowledge), version ticks (Software), type ledger (Files),
request steps (Services), live RSVP dots — real state only (R-31).
This is the one memorable element; everything around it stays quiet.

## Copy voice
Plain verbs, sentence case. Buttons name outcomes: "Read the guide",
"Download for Windows", "Request this help", "Join the cleanup".
Empty states name cause + next action, never "No data available".
Placeholders are honest: "Your Name", "you@example.com".
