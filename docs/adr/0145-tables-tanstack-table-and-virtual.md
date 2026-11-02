# 0145. Tables and long lists are TanStack Table 9 with TanStack Virtual 3, styled by the app and driven by J/K from a window key listener

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: STACK-010 (tables, lists and virtualisation). Touches the My work slide list, the project slides and tasks tabs, the layers list in the viewer, the audit views and STACK-014 (command palette, drag and drop, hotkeys).

## Context

Worklists in a pathology department can hold thousands of slides, and the reviewer moves through them with J and K. The app's tables today are hand-written `<table>` markup over fake data, such as `all-slides-tab.tsx`, which render every row. The kit's `Table` parts in `packages/ui/src/components/table.tsx` are plain styled elements. The app runs React 19.3 with React Compiler ([ADR 0016](0016-react-19-spa-compiler-strictmode.md), React 19 SPA with the compiler and StrictMode), and every visual comes from the design tokens and the frozen mock ([ADR 0144](0144-charts-hand-made-svg-with-visx.md), charts as hand-made SVG, follows the same rule).

The spike numbers are in [results/2026-11-02-worklist-virtualisation-spike.md](../results/2026-11-02-worklist-virtualisation-spike.md). Versions were checked on npm on 2026-11-02.

## Options considered

1. TanStack Table 9.3 with TanStack Virtual 3.14. Headless, so the markup, tokens and accessibility stay ours. Table gives column models, sorting, filtering, selection and grouping as opt-in features, and Virtual windows the rows. Together they cost 18.8 KB gzip. In the spike 10,000 rows kept 60 fps with one J per frame, also at a 4x CPU throttle. React Compiler refuses to compile the component that calls `useVirtualizer` and leaves it as plain React, which is safe but means that component must stay small. Table 9 is a new major with a changed API (`useTable`, `tableFeatures`), so most examples online are still for version 8.
2. AG Grid Community 36.2. A complete grid with virtualisation, editing, column moving and keyboard navigation built in. Its smallest useful bundle is 194 KB gzip, about ten times option 1, and it draws its own DOM and themes, so matching the mock means overriding its theme rather than writing our markup. Row grouping, the tool panels and other parts sit in the paid Enterprise edition. It was not rendered in the spike.
3. TanStack Virtual alone, with hand-written column logic. The smallest option, and enough for a list with fixed columns. Sorting, filtering, column visibility and selection would be written and tested by us for every view.
4. No virtualisation. The spike's plain table re-rendered 10,000 rows on every key press and ran at 16 fps, and at 3 fps with a 4x throttle.

## Decision

| Concern | Choice |
|---|---|
| Table model | TanStack Table 9 (`@tanstack/react-table`) with only the features a view uses, registered in `tableFeatures` at module scope |
| Long lists | TanStack Virtual 3 (`@tanstack/react-virtual`) for any list whose length the design does not bound, with a fixed row height from the tokens and `scrollMargin` and `scrollPaddingStart` for a sticky header |
| Markup | Semantic `<table>`, `<thead>`, `<tbody>` and `<tr>` laid out with CSS grid, styled with the app's tokens, so lint's semantic element rules hold |
| Keyboard | J, K, the arrows, Home and End move an active row index from a window `keydown` listener, and the view calls `scrollToIndex` with `align: "auto"`. The active row carries `aria-selected`. STACK-014 (hotkeys) later moves the bindings into the shared hotkey layer without changing this shape |
| React Compiler | The component that calls `useVirtualizer` stays small, and passes plain values (index, active flag, pixel offset) to a compiled row component. A row never receives a new object or function on every render |
| AG Grid | Not used |

TanStack wins because it keeps the look and the accessibility in our hands at a tenth of AG Grid's bytes, and the spike met the 60 fps target with it. The cost is that Table 9 is young and the compiler skips the virtualiser's component. Both are contained by the rules above. If a later view needs spreadsheet-style editing of many cells, AG Grid is the option to measure again.

## Consequences

- `apps/web` depends on `@tanstack/react-table` 9.3.1 and `@tanstack/react-virtual` 3.14.25.
- The spike stays at the dev-only route `/spikes/worklist`, with `e2e/worklist-spike.spec.ts` checking the J/K behaviour on every run and measuring frame rate when `WORKLIST_FPS=1` is set. It is the template for the real worklist and is deleted when the first real view adopts the pattern.
- Existing prototype tables are not rewritten by this decision. Each one moves to the pattern when its view gets real data.
- A 120 Hz display and a production build were not measured (TODO in the result file).
