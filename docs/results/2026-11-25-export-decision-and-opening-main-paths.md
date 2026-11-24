# Result: export, decision and opening on the local stack

- Date: 2026-11-25
- Backlog: TEST-060 (the main paths the performance measurement still lacks), after TEST-019 (application performance on main paths)
- ADR: [0353](../adr/0353-main-path-budgets-are-a-p95-after-a-warm-up.md) (main path budgets are a p95 after a warm-up)
- Budgets fixed in `perf-budgets.json` before the first measured run, in the commit that adds this file.

## Question

How long does a researcher wait for the export of a signed-off slide, as a QuPath GeoJSON zip and as COCO patches, and how fast are a decision and opening a slide on a production build through the real API and the application's own slide delivery, against budgets set before measuring?

## Budgets

Fixed before any timing code ran. Each is a limit for the p95.

| Budget id | Path | Limit | How it was chosen |
|---|---|---:|---|
| `app.export-geojson-1k-p95-ms` | Training dataset zip, 1,000 annotations | 2,000 ms | A download the researcher clicks and waits on, with no progress shown. Two seconds is the longest wait for a plain download that does not need a progress bar. |
| `app.export-geojson-10k-p95-ms` | Training dataset zip, 10,000 annotations | 5,000 ms | The same limit TEST-019 set for importing 10,000 cells. Writing the objects out should not take longer than reading them in. |
| `app.export-coco-1k-p95-ms` | COCO patches, 1,000 annotations | 15,000 ms | A job with a progress dialog, so a longer wait is fine. A quarter of the 60 s TEST-019 allowed for the largest import. |
| `app.export-coco-10k-p95-ms` | COCO patches, 10,000 annotations | 30,000 ms | Half of that 60 s. The pixels cut are the same as at 1,000, only the masks and the COCO file grow. |
| `app.open-production-ready-p95-ms` | Open, navigation to ready | 3,000 ms | Unchanged from TEST-019, so the production build is judged by the same line as the dev server. |
| `app.decision-production-p95-ms` | Decision to the next object | 100 ms | Unchanged from TEST-019, which the real API missed on the dev server. |

TODO: method, machine, results and conclusion follow the measured runs.
