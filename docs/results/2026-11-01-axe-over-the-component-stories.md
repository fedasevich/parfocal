# Result: axe over the component stories

- Date: 2026-11-01
- Backlog: DS-000 (design system tooling check), STACK-007 (component primitives and styling)
- Kind: baseline
- Commit: the `feat(DS-000)` commit on top of f1daa0e
- Environment: the owner's Mac, macOS 15.8.1, Node 26.13.0, Google Chrome 156.0.8078.74 headless through Playwright 1.64.0, axe-core 4.14.0 through `@axe-core/playwright` 4.14.0, Storybook 10.6.5 static build
- Data: 30 stories of the 11 controls in ADR 0130 (shadcn/ui on Base UI with Tailwind CSS v4), with made-up labels and names and no PHI

## Question

Do the shadcn/ui components on Base UI, styled with the kit's first-pass tokens, pass axe in dark and light? STACK-007 (component primitives and styling) asks for axe-clean output before it is ticked.

## Method

1. `pnpm --filter @parfocal/ui test:browser`, which runs `storybook build` and then `playwright test` in `packages/ui`.
2. Playwright serves `storybook-static` with `vite preview` on port 6007 and reads every story from `storybook-static/index.json`.
3. For each story and each theme, it opens `iframe.html?id=<story>&viewMode=story&globals=theme:<theme>;a11y.manual:!true`, waits for the root to render, for `data-theme` on `html` and for running animations to settle (at most 2 s), and runs axe with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a` and `wcag22aa`.
4. Elements matching `[data-base-ui-focus-guard]` are excluded (see Interpretation).
5. A test fails on any violation. A separate test checks that each of the 11 controls has a story.

Popups are measured open: the Popover, Dialog, Dropdown menu, Select, Combobox and Tooltip stories each have an `Open` story rendered with `defaultOpen`.

## Results

Stories per control.

| Control | Stories |
|---|---|
| Button | Primary, Variants, Sizes, With icon, Icon button, Disabled |
| Toggle group | Segmented, Icons, Disabled |
| Switch | Off, On, Disabled, With label |
| Popover | Closed, Open |
| Dialog | Closed, Open |
| Dropdown menu | Closed, Open |
| Tabs | Default, Line |
| Slider | Default, Range, Disabled |
| Select | Closed, Open |
| Combobox | Closed, Open |
| Tooltip | Closed, Open |

First run, on the components as generated plus the token mapping, before any fix. 60 story and theme pairs, 16 failed.

| Rule | Story | Themes | What axe reported |
|---|---|---|---|
| `color-contrast` | Button, Variants | dark | Link button text `#2563eb` on `#121212` is 3.62:1 |
| `color-contrast` | Tabs, Line | light | Inactive tab text `#6c6c6c` on `#ececec` is 4.44:1 |
| `label` | Slider, Default, Range and Disabled | dark, light | The thumb inputs have no name |
| `button-name` | Combobox, Closed | dark, light | The chevron button has no name |
| `aria-hidden-focus` | Combobox, Open | dark, light | The input group's addon is `aria-hidden` while open and holds the focusable chevron button |
| `aria-hidden-focus` | Select, Open and Dropdown menu, Open | dark, light | Base UI's focus guard spans have `tabindex="0"` and `aria-hidden="true"` |

Runs after the fixes, on the same machine. Some runs followed a fresh `storybook build`, others reused the build.

| Runs | Tests per run | Runs with every test passing | Runs with failures | Failed tests |
|---|---|---|---|---|
| 19 | 61 | 17 | 2 | 3 |

Each of the two runs with failures took 1.0 min instead of about 14 s, and every failure was a 30 s test timeout on a story that passed in every other run. Neither run could be reproduced on demand, and no failure was an axe violation.

## Interpretation

- The kit's colours pass axe once each component uses the kit token that means the same thing. The link button now uses `accent` (`#94c0ff` dark, `#1d5fd1` light) instead of the fill colour, and inactive tabs use `fg-dim`.
- The slider and combobox findings are real gaps in the shadcn wrappers, fixed in our copies (thumb labels through `getAriaLabel`, and a named chevron button out of the tab order).
- The focus guard exclusion is a judgement, not a measurement. Base UI moves focus away from a guard as soon as it receives it, so a keyboard user never rests on a hidden element, and assistive technology never announces it. Assumption: Base UI keeps this behaviour. A later Base UI version should be checked without the exclusion.
- Assumption: the timeouts came from load on the machine, because both runs followed other heavy commands and nothing in the stories changed between runs. The suite now retries a failed test once in CI, where Playwright reports it as flaky, and keeps a trace of a local failure. TODO: if the CI `browser` job reports flaky axe tests, open the trace and fix the cause.
- Best-practice rules such as `region` are not run, because a story frame is a fragment and not a page. Page-level rules belong to the screen tests.
- These are first-pass token values from the hi-fi mock. The round 6 redesign may change them, and the suite reruns on every change.

## Follow-ups

- ADR 0130 (shadcn/ui on Base UI with Tailwind CSS v4) records the outcome in place of its TODO.
- DS-001 (design tokens package) refreshes the token values from the frozen kit, and the axe suite checks them again.
- The lessons are in [knowledge/frontend-ui.md](../knowledge/frontend-ui.md).
