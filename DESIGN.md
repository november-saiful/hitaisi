# DESIGN.md — Hitaisi

Subject: a free benevolent commons. Audience: learners, sharers, volunteers.
Job of the homepage: show what was freely given this week, and where to give.

## Palette — strict monochrome, nothing else (R-01, R-29)
- `paper` #FAFAF8 — page base (light default; content-first product)
- `ink` #111110 — text
- `accent` #111110 — the ONE accent, pure black. Used only at the key moment:
  primary publish/download CTA + active hub marker. Nowhere else.
- Supporting neutrals: `clay` #E4E1DA (hairline/fill), `stone` #6E6A62 (secondary text)
- Dark theme: `paper` #101010 base, `ink` #F2F0EA text, `accent` #F2F0EA (white).
- No hue anywhere: no green, no blue-purple gradients, no rainbow, no neon, no radial orbs (R-01).

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

## Rhythm dial: 3 — dashboard chrome, per-hub bodies
- Frame (all pages): left sidebar (brand, Commons nav, Workspace nav, latest-guides rail, free-forever card, real profile) + sticky topbar (breadcrumbs, search, theme, sign-in). No dead controls: every button navigates or acts.
- Dashboard: 4 real-count stat cards + latest-guides and gatherings tables.
- Knowledge: stat pair + filter + paginated table; detail uses essay + inspector side panel.
- Software / Files: stat pair + filters + tables with real pagination; publish forms below.
- Services: stat pair + offer cards with inline request forms; offer form below.
- Social: stat pair + gatherings table with inline join; propose form below.
- Status pills carry meaning + label (Live = filled, Open/Pending = outline, No binary/Draft = dashed, Rejected = struck). Counts and badges are always real queries, never invented (R-17, R-18, R-38).
- No bento mosaic, no fake terminal, no logo bar, no invented stats (R-05, C-3).

## Motion dial: 2 (purposeful reveals + hover micro-interactions, no loops)
- Entry: fade-up 8px + de-blur 2px, 240ms `cubic-bezier(0.23,1,0.32,1)`, once per route. Stagger 40ms cascade on stat groups only — decorative, never blocks input.
- Press: every pressable scales to 0.97 in 160ms ease-out (`:active`); release snaps back. Hover lift (1-2px) gated behind `@media (hover:hover) and (pointer:fine)`.
- Curves: `--ease-out` for enter/feedback, `--ease-in-out` for on-screen morphs, `--ease-drawer` for the sidebar (320ms). Never `ease-in`, never `transition: all`, never `scale(0)` — enter from `translateY(8px)` + `opacity:0` + `blur(2px)`.
- Only `transform` + `opacity` (+ `filter: blur` as bridge) animate; rows crossfade `background-color` 150ms. No endless pulse/float/spin (R-19). `prefers-reduced-motion` keeps opacity fades, drops all displacement.

## Signature: the Giving Ribbon + inspector panels
One continuous 2px black thread marks real state per hub; detail views pair
content with an inspector side panel (meta, status, dates). This is the one
memorable element; everything around it stays quiet.

## Mobile (whole project)
- ≤960px: sidebar becomes an overlay drawer (hamburger, scrim, drawer close);
  topbar condenses (search shrinks, sign-in collapses to arrow); detail grids stack.
- ≤560px: stats go 2-up; page heads stack full-width.
- Tables never break layout: `.table-wrap` scrolls horizontally.
- Full-height uses `100dvh`; touch targets stay ≥32px.

## Copy voice
Plain verbs, sentence case. Buttons name outcomes: "Read the guide",
"Download for Windows", "Request this help", "Join the cleanup".
Empty states name cause + next action, never "No data available".
Placeholders are honest: "Your Name", "you@example.com".
