# Result: 10,000 worklist rows with J/K navigation, virtualised against plain

- Date: 2026-11-02
- Backlog: STACK-010 (tables, lists and virtualisation)
- Kind: spike
- Commit: the code measured is the STACK-010 commit on top of b9e5f84 (`apps/web/src/screens/worklist-spike/`, route `/spikes/worklist`, measured by `apps/web/e2e/worklist-spike.spec.ts`)
- Environment: MacBook, macOS Darwin 24.6.0, Chrome 156 through Playwright 1.64, Vite 8 dev server with React 19.3 in development mode and React Compiler on. Viewport 1280 by 720. The headless and the headed runs both showed a 60 Hz frame clock, so nothing here says what happens above 60 Hz.
- Data: 10,000 synthetic rows from a seeded generator (slide name, project and case, result set count, reviewer avatar with state, status tag, due date). No PHI.

## Question

Does TanStack Table 9 with TanStack Virtual 3 render 10,000 worklist rows and keep 60 fps while J/K moves the active row, which is the STACK-010 "Done when"? How does the same table do without virtualisation, and what do the candidate libraries cost in bundle size?

## Method

1. Installed `@tanstack/react-table` 9.3.1 and `@tanstack/react-virtual` 3.14.25 (with `@tanstack/virtual-core` 3.19.10) in `apps/web`, versions checked on npm on 2026-11-02.
2. Built the spike table with `useTable` and a core-only `tableFeatures({})`, six columns rendered with the kit's `Person` and `StatusTag`. Rows are 44 px high with a sticky 36 px header. Virtual mode uses `useVirtualizer` with a fixed `estimateSize`, overscan 10 and `scrollMargin` and `scrollPaddingStart` equal to the header. Plain mode renders every row. J, K, the arrows, Home and End move the active row from a window `keydown` listener, which then calls `scrollToIndex` with `align: "auto"` (plain mode calls `scrollIntoView`).
3. Ran `CI=1 WORKLIST_FPS=1 WORKLIST_CPU_THROTTLE=<1 or 4> pnpm exec playwright test e2e/worklist-spike.spec.ts` in `apps/web`. For each mode the test opens the page, waits for row 0, then records `requestAnimationFrame` timestamps for 3 seconds twice. In the keys pass, every frame dispatches one `keydown` for `j` on `window` from the page, which is one press per frame, about twice the macOS key repeat rate. In the scroll pass, every frame adds 120 px to the scroller's `scrollTop`. Fps is frames divided by the time span. A dropped frame is a gap over 17 ms.
4. Throttle 4 means `Emulation.setCPUThrottlingRate` at 4 through the Chrome DevTools Protocol, as a stand-in for a slow hospital laptop. That stand-in is an assumption.
5. React Compiler: ran babel-plugin-react-compiler 1.0.0 with a logger over the spike files and listed its events.
6. Bundle size: in a scratch directory, bundled one entry per candidate with rolldown 1.2.16 `--minify`, React external, and measured `gzip -9`. The TanStack entry imports `useTable`, `tableFeatures`, `createColumnHelper` and `useVirtualizer`. The AG Grid entries register `AllCommunityModule`, or only `ClientSideRowModelModule`, and import `AgGridReact` (ag-grid-community and ag-grid-react 36.2.0).

## Results

Final code, headless Chrome, 60 Hz frame clock.

| Mode | CPU throttle | Rows in the DOM | Page to row 0 (ms) | Keys fps | Keys p95 frame (ms) | Keys dropped | Scroll fps | Scroll longest frame (ms) | Scroll dropped |
|---|---|---|---|---|---|---|---|---|---|
| Virtual | 1x | 25 | 1777 | 60.0 | 16.7 | 0 of 181 | 60.0 | 16.7 | 0 of 181 |
| Virtual | 4x | 25 | 1863 | 60.0 | 16.7 | 0 of 181 | 59.0 | 33.3 | 3 of 178 |
| Plain | 1x | 10,000 | 2174 | 16.1 | 100.0 | 49 of 49 | 59.7 | 33.3 | 1 of 180 |
| Plain | 4x | 10,000 | 8714 | 2.9 | 533.3 | 9 of 9 | 35.1 | 200.0 | 23 of 106 |

An earlier version of the virtual row took its position as a fresh `style` object, so every visible row re-rendered on each key press. At 4x it measured 55.7 fps on keys (13 of 168 frames dropped, p95 33.3 ms) and 53.7 fps on scroll. Passing the row's offset as a number instead brought it to the 60 fps above. A headed run of that earlier version at 1x gave 60.0 fps on keys and scroll for virtual, and 15.3 fps on keys for plain.

The page-to-row-0 time includes the dev server serving modules and is not a production load time.

React Compiler 1.0.0 compiled `useWorklistTable`, `WorklistLine` and the route component. It skipped `WorklistSpike`, the component that calls `useVirtualizer`, with `IncompatibleLibrary` ("This API returns functions which cannot be memoized without leading to stale UI").

| Bundle (React external) | Minified (bytes) | Gzip (bytes) |
|---|---|---|
| TanStack Table 9.3.1 and Virtual 3.14.25 | 62,964 | 18,764 |
| AG Grid 36.2.0, all community modules | 1,155,297 | 317,364 |
| AG Grid 36.2.0, client-side row model only | 697,492 | 194,074 |

## Interpretation

The virtualised table meets the "Done when" on this machine. It keeps 60 fps with one J per frame at full speed and at a 4x CPU throttle, with 25 rows in the DOM out of 10,000. The plain table shows why virtualisation is needed. Each key press re-renders 10,000 rows, which gives 16 fps at full speed and 3 fps at 4x, and opening it at 4x took 8.7 seconds.

Two rules come out of the spike. React Compiler will not compile the component that calls `useVirtualizer`, so that component should stay small and pass plain numbers to row components that the compiler does compile. And a row must not receive a new object on every render, which is what cost about 4 fps at 4x.

AG Grid was not rendered, so there is no frame rate for it (TODO if it is ever reconsidered). Its smallest useful bundle is about ten times the TanStack pair.

These numbers are from the dev build, which is slower than production, so they are a pessimistic bound for the same machine. A 120 Hz display was not measured (TODO).

## Follow-ups

- [ADR 0145](../adr/0145-tables-tanstack-table-and-virtual.md) (tables are TanStack Table and TanStack Virtual) records the choice.
- The real worklist, layers list and audit views adopt the pattern when their tasks are built. The spike route stays dev-only until then.
