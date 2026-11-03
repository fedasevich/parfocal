# 0227. IBM Plex is vendored into the tokens package, loads with font-display optional, and a source scan keeps every size on the type scale

- Date: 2026-11-03
- Status: Accepted
- Deciders: the agent doing DS-003 (typography)
- Backlog: DS-003 (typography). Builds on DS-017 (density modes) and DS-018 (surfaces and zones), whose tokens sit in the same package

## Context

DS-003 asks for IBM Plex Sans and IBM Plex Mono, self hosted, nine sizes and nothing between them, fonts that load without layout shift, and a lint check that fails on a size off the scale. Before this change the tokens named Plex in `--font-ui` and `--font-data` but no font file shipped, so every screen drew in the system fallback. About 150 places used Tailwind's own sizes (`text-sm`, `text-lg`) or raw pixel sizes (`text-[18px]`, `text-[22px]`).

Three choices had real alternatives.

1. Where the files come from. A `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` dependency, or the woff2 files committed to `packages/tokens/fonts`.
2. How the font swaps in. `font-display: swap` with a fallback face tuned by `size-adjust` and the ascent overrides, or `font-display: optional`.
3. What the lint is. A Biome or oxlint plugin rule, a Stylelint rule, or a source scan run as a test.

## Decision

1. The woff2 files are copied from `@fontsource/ibm-plex-sans` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0 (published 2026-07-19) into `packages/tokens/fonts`, with the SIL Open Font License beside them. Sans ships 400, 500, 600 and 700 in the latin and latin-ext subsets, Mono ships 400, 500 and 600 in latin, about 230 KB in all. The `unicode-range` of each face means a page fetches latin-ext only when a name needs it. `packages/tokens/src/fonts.css` declares the faces and `globals.css` imports it first.
2. Every face uses `font-display: optional`. A font that is not there within the browser's short block period is skipped for that page view, so text never moves. Files are small and same origin, so after the first visit they come from cache and always draw.
3. `typeScaleProblems` in `@parfocal/tokens/type-scale-lint` finds raw pixel sizes, Tailwind's own size names, CSS `font-size` values that are not a `--text-*` token, and `fontSize` in style objects. `packages/ui/test/type-scale.test.ts` runs it over the kit, its stories and `apps/web/src`, so `pnpm verify` fails on a size off the scale. The Tailwind theme also clears its default sizes with `--text-*: initial`, so only the nine scale classes exist.

Two kinds of file are exempt, each listed with its reason in that test. Printed page previews (the evaluation and clinical reports and their templates) draw an A4 page at reduced size on a paper scale. Glyphs inside a graphic mark (avatar initials, the workspace mark, ring percentages, the tool rail key hint and the pin number on a slide still) scale with the mark. The test fails when an exempt file no longer needs its exemption.

## Consequences

- A font upgrade is a manual copy from a newer fontsource release, checked by the typography test, not a lockfile bump. Nothing new enters the dependency tree.
- On a first visit over a slow link, a screen can draw in the system sans for that one page view. That is the price of zero layout shift, and the browser test with a delayed font pins it.
- Four title sizes now default to weight 600 through `--text-*--font-weight`, so a heading needs no `font-semibold`. Label stays at the body weight because tags, counts and keycaps share its 11 px size.
- `text-lg` became `text-title-sm` and so moved from a 28 to a 24 px line height, and the 22 px dev page headings became 24 px page titles, the nearest step.
- A Biome or oxlint plugin would flag sizes in the editor. That can replace the scan later without changing the rule.
