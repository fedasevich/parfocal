# Result: What each chart library adds to a React bundle, and whether it passes token colours and names through

- Date: 2026-11-02
- Backlog: STACK-011
- Kind: spike
- Commit: e08504d (nothing in the repository was measured, the spike ran in a scratch folder)
- Environment: macOS 15 (Darwin 24.6.0), Node 26.13.0, esbuild 0.28.2, jsdom 30.1.3
- Data: none, each entry draws two or three made-up numbers

## Question

How many gzipped bytes each chart library candidate adds on top of React, and whether a colour given as `var(--token)` and an accessible name reach the drawn SVG unchanged. No budget exists for this yet.

## Method

In an empty scratch folder, `npm i` of react and react-dom 19.3.1, @visx/scale, @visx/shape, @visx/axis and @visx/group 4.0.0, @observablehq/plot 0.6.17, recharts 3.10.1 and echarts 6.1.0. One entry file per library mounts a React root and draws a bar and a line:

- `base` mounts an empty `<svg/>` with `createRoot` only.
- `visxmin` draws a `Bar` and a `LinePath` with a `scaleLinear`.
- `visx` adds an `AxisBottom` with a `scaleBand`.
- `plot` appends `Plot.plot` with `barY` and `lineY`.
- `recharts` draws a `BarChart` with axes and a `LineChart`.
- `echarts` imports `echarts/core` with only the bar and line charts, the grid and aria components and the SVG renderer.

Each was bundled with `esbuild FILE --bundle --minify --format=esm --jsx=automatic --define:process.env.NODE_ENV='"production"'` and measured with `wc -c` and `gzip -9c | wc -c`.

A second script rendered `Plot.plot` under jsdom with `fill: "var(--accent-fill)"`, `ariaLabel` and `ariaDescription` and printed the SVG. The installed sources of Recharts and ECharts were searched for their accessibility defaults.

## Results

| Entry | Minified bytes | Gzipped bytes | Gzipped bytes over `base` |
| --- | --- | --- | --- |
| base (React only) | 223,472 | 69,066 | 0 |
| visxmin | 267,531 | 85,260 | 16,194 |
| visx | 293,799 | 94,283 | 25,217 |
| plot | 510,744 | 166,914 | 97,848 |
| recharts | 581,809 | 177,924 | 108,858 |
| echarts | 756,504 | 254,216 | 185,150 |

| Check | Finding |
| --- | --- |
| Plot keeps `var(--accent-fill)` | Yes, the bar's `fill` attribute reads `var(--accent-fill)` |
| Plot accessible name | `aria-label` and `aria-description` on the root `<svg>`, no `role`, and every axis tick group carries its own `aria-label` |
| visx | Renders plain React SVG elements, so `fill`, `role` and `aria-*` are whatever the component passes |
| Recharts 3.10.1 | `accessibilityLayer` defaults to true and gives the chart `role="application"` with keyboard focus |
| ECharts 6.1.0 | The aria component sets `role="img"` and a generated `aria-label` on the container element |
| Peer dependencies | visx 4.0.0 accepts React 18 or 19, Recharts 3.10.1 accepts React 16 to 19, Plot and ECharts have none |

## Interpretation

visx adds about a quarter of what Plot or Recharts add and a seventh of ECharts, because it is a thin layer over d3-scale and d3-shape. Plot and Recharts cost about the same. The numbers are for a toy chart and a real screen pulls in more of each library, so treat them as a floor. The jsdom check shows Plot passes CSS variables through, and visx does by construction because it writes React props.

## Follow-ups

- [ADR 0144](../adr/0144-charts-hand-made-svg-with-visx.md) (charts are hand-made SVG with visx primitives) uses these numbers.
- TODO: measure again inside `apps/web` when the first chart task adds visx, against the route chunk it lands in.
