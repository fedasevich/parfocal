# 0144. Charts are hand-made React SVG in packages/ui with visx primitives for scales and axes, coloured only by token variables and always readable as text

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: STACK-011. Touches REVIEW-005, REVIEW-017, MLEVAL-009, HOME-004 and every later task that draws a chart.

## Context

STACK-011 (charts for dashboards and confidence visuals) picks how the web app draws charts. The backlog default was visx for the custom tumor share range bars and sparklines and Observable Plot for dashboard charts.

The app has no chart library today. `packages/ui` already draws its few visuals by hand: `ScoreHistogram` and `ClassCounts` in `visualize.tsx` as divs, `ProgressBar` and the meters in `progress-meter.tsx`, the lane map, and `ConfusionMatrix` in `evaluation-report.tsx` as a real table. What is planned is small. REVIEW-005 (the number line) needs the tumor share with its likely range and class bars split into sure and unsure cells, REVIEW-017 (tumor share result) puts a cutoff on it, the evaluation report needs agreement numbers and a confusion matrix, and the score histogram has a cutoff. The only in-app dashboard, HOME-004 (department dashboard), is an idea that is not planned. MLEVAL-009 (evaluation dashboard) is a static report built offline, not a screen of the app.

Two constraints shape the choice. Dark is the default theme and light is a `[data-theme="light"]` scope that can be nested, as the kit stories do, and Tailwind's `dark:` variant does not flip inside a nested scope ([knowledge/frontend-ui.md](../knowledge/frontend-ui.md)). The app runs React 19 with React Compiler ([ADR 0016](0016-react-19-spa-compiler-strictmode.md), React 19 as a single page app) and TypeScript 7 with `exactOptionalPropertyTypes`.

Bundle cost and the accessibility defaults were measured in [the chart library bundle cost result](../results/2026-11-02-chart-library-bundle-cost.md).

## Options considered

| Option | Gzipped bytes over React | For | Against |
| --- | --- | --- | --- |
| 1. Hand-made SVG with visx scales, shapes and axes | 16,194 to 25,217 | Plain React elements, so tokens and ARIA are ours. Matches the kit's existing hand-made visuals | Every chart is code we write and test |
| 2. visx plus Observable Plot for dashboards (backlog default) | visx plus 97,848 | Plot makes a new dashboard chart in a few lines | Two ways to draw, Plot draws its own DOM outside React, its root has `aria-label` but no role and labels every tick |
| 3. Recharts | 108,858 | Ready-made React charts, keyboard layer on by default | `role="application"` is wrong for a static chart, styling goes through its props, and the custom range bar would be hand-made anyway |
| 4. ECharts with the SVG renderer | 185,150 | Every chart type, an aria component that writes a summary | The largest, configured by an options object outside React, and its canvas renderer cannot read CSS variables |

## Decision

Option 1. Charts are React components in `packages/ui/src/components/charts/`, drawn as SVG or divs. A chart with one value or a few bars, such as the range bar, a sparkline or a meter, needs no library. A chart with a numeric axis, bands or many series uses `@visx/scale`, `@visx/shape` and `@visx/axis`, added to `packages/ui` by the first task that needs them. Plot is left out because nothing planned needs its speed of authoring, and it would cost four times visx for a second drawing model. Plot stays the natural choice for the offline static report of MLEVAL-009, which never ships in the app bundle.

### Theming through tokens

- Every `fill`, `stroke` and text colour is a `var(--token)` string or a `color-mix()` of one, never a hex value and never a `dark:` class. The browser then resolves each mark in whatever theme scope it sits, nested ones included, and a theme switch needs no redraw.
- Class series use the class tokens `--c-tumor`, `--c-stroma`, `--c-immune` and `--c-other`. Verdict series use `--v-agree`, `--v-disagree`, `--v-unsure` and `--v-open`. A single series uses `--accent-fill`. A cutoff or reference line uses `--line-strong`, grid lines use `--line`, and axis text uses `--fg-dim` at the kit's caption size.
- An intensity scale, such as the confusion matrix diagonal, is `color-mix(in srgb, var(--accent-fill) N%, transparent)` with N from the value.
- There is no general categorical palette. TODO: when a chart needs series that are neither classes nor verdicts, add chart series tokens to `themedTokens` in `packages/tokens/src/index.ts`, which `tokens.test.ts` then checks in both themes.

### Accessibility

- A chart is a `<figure>` with a caption. Either its numbers are a real table with `scope` headers, like `ConfusionMatrix`, or its drawing is `role="img"` with an `aria-label` that states the reading, like `ScoreHistogram`'s "Scores in 10 bins from 0 to 1, cutoff 0.50". Axis ticks and grid lines inside a `role="img"` drawing are `aria-hidden`.
- A chart with more values than its label can say, such as a trend over weeks, also offers the same numbers as a table, visually hidden or behind a "Show as table" toggle.
- Colour is never the only carrier. A class or verdict series also has a text label, a position or a pattern, as WCAG 1.4.1 (use of colour) asks, and marks keep 3:1 against their panel in both themes, as WCAG 1.4.11 (non-text contrast) asks.
- Charts do not animate. A later transition must stop under `prefers-reduced-motion`.
- Each chart has a story in both themes that the axe pass over component stories covers, and a component test that checks its accessible name or table against the data it was given.

## Consequences

- No package is added now. The first chart task adds the visx packages to `packages/ui`, and the measurement is repeated in the real build.
- The tumor share range bar and the split class bars of REVIEW-005 (the number line), with the cutoff chip of REVIEW-017 (tumor share result), are hand-made charts under these rules.
- `ConfusionMatrix` still uses hex colours (`#444`, `#eef3fb` and an `rgba` of the accent) because the evaluation report is drawn as a light paper page. TODO: move it to a `data-theme="light"` scope with token colours when the report is next touched.
- If an in-app dashboard with many chart kinds is planned, such as HOME-004, this ADR is the place to reopen the Plot option, with a new bundle measurement.
