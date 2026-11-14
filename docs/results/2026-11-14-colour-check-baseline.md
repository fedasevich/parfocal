# Result: Colour check of the design tokens, baseline for CI

- Date: 2026-11-14
- Backlog: DS-002 (colour measurement scripts in CI)
- Kind: baseline
- Commit: the DS-002 commit that adds `packages/tokens/src/colour-check.ts`
- Environment: MacBook, Node.js with type stripping, `pnpm --filter @parfocal/tokens colour-check`
- Data: `packages/tokens/src/tokens.css` as of this date, and 9668 pixels sampled every 331st pixel from the frozen mock's `mid-10x.jpg` and `hpf-40x.jpg` (`packages/tokens/data/he-pixels.json`)

## Question

Do the current tokens meet the text, graphic, class separation and outline limits, and which numbers should CI hold as the baseline?

## Method

The script ports the POC's `color-check.mjs` checks. Text pairs need WCAG 2 at least 4.5 and APCA Lc at least 60 in both themes. Graphics need WCAG 2 at least 3. Class and mark separation is CIEDE2000 after Machado simulation, with the limits read from `apps/api/src/parfocal_api/taxonomy.py`. An outline counts as uncovered on a pixel when neither the outline nor its casing reaches 3:1 against it.

## Results

| Check | Measured | Limit |
|---|---|---|
| Every text pair, both themes | all pass | 4.5 and Lc 60 |
| Closest class pair, tumor and stroma, deuteranopia | 15.102 | 15 |
| Unsure zones on the slide, nearest stroma | 13.765 | 13 |
| AI proposals, nearest tumor | 43.685 | 40 |
| Unsure in the dark panel, nearest stroma | 15.548 | 15 |
| Unsure in the light panel, nearest tumor | 30.388 | 15 |
| Control border on the raised card, dark theme | 2.977 | 3 (fails) |
| Tumor outline with casing, uncovered pixels | 9.7% | 5% (fails) |
| Immune outline with casing, uncovered pixels | 8.0% | 5% (fails) |
| AI proposal, stroma and other outlines with casing | 0.0% | 5% |

## Interpretation

- The doc 35 numbers hold: 15.1, at least 40, at least 13 and at least 15.
- Three checks are below their target today. CI holds them at today's level so only a regression fails: control border on the raised card at 2.97, the tumor outline at 10% and the immune outline at 9%. The 5% default for outlines is a first limit, not a measured requirement.
- Assumption: the baselines stay until the design owner decides to raise the raised-card border and the tumor and immune casing.

## Follow-ups

- TODO: raise `--line-strong` on `--chrome-2` in the dark theme to 3:1, then remove the baseline in `colour-check.ts`.
- TODO: decide whether tumor and immune outlines need a heavier casing on dense nuclei.
