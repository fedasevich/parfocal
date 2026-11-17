# Result: The first page shrinks from 363,543 to 355,662 gzip bytes when the API client is marked free of side effects

- Date: 2026-11-17
- Backlog: FOUND-031
- Kind: baseline
- Commit: 6af8bf52 plus the change in this commit
- Environment: macOS 15 (Darwin 24.6.0), `pnpm analyze:web` (production build of `apps/web` in the analyze mode), gzip of node:zlib at the default level
- Data: none

## Question

Which dependencies and shell code the first page loads without showing, and how many gzip bytes can leave it.

## Method

`pnpm --filter @parfocal/web analyze` builds the app. The first-page size is the sum of the gzip sizes of every JavaScript and CSS file that `dist/index.html` names in a `src` or `href`, the same count `apps/web/test/route-chunks.test.ts` makes for the budget `web.first-page-gzip-bytes`. The module breakdown comes from `bundle-report/summary.json`.

## Findings

The first page is 363,543 gzip bytes in 79 files before the change. The largest parts by raw size are react-dom 537 KB, `@base-ui/react` 343 KB, the generated API client 234 KB, zod 175 KB, `@tanstack/router-core` 115 KB and `cn` 106 KB.

The shell is already lazy where it counts. The command palette dialog, the notifications panel, the survey card, the tour and the feedback form are all behind `React.lazy`, and every route page is its own chunk.

The generated API client and zod arrive in one shared chunk because the first page and the lazy routes both use them, and the draft hooks build their zod schemas when the module loads. Marking `@parfocal/api-client` with `"sideEffects": false` lets the bundler drop every client module the first page does not use.

## Result

- Before: 363,543 gzip bytes in 79 files.
- After: 355,662 gzip bytes in 80 files, 7,881 bytes (2.2 percent) fewer.
- The budget `web.first-page-gzip-bytes` drops from a limit of 380,000 to 366,000, the new size plus 10 KB of headroom.

## What did not work

Loading the benchmark debug handle with an awaited `import()` at the top of `main.tsx` made the entry chunk smaller but Vite then preloaded 133 files, route chunks included, and the first page grew to 435,591 gzip bytes. An awaited dynamic import at the top level of the entry must be avoided, or gated by a compile-time constant as the developer tools already are.

## Next candidates

- The shared chunk with the API client and zod (about 46 KB gzip) could shrink if the draft schemas were built on first use.
- `cn` (106 KB raw, 16 KB gzip) is the class merger and is larger than most of the app code.
- `icon-set.tsx` holds every icon body (31 KB raw) and loads with the first page.

## Reproduce

Run the audit again as in [tooling.md](../knowledge/tooling.md#repeat-the-first-page-audit-at-each-milestone).
