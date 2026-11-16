# Result: application performance on six main paths

- Date: 2026-11-16
- Backlog: TEST-019 (application performance on main paths)
- ADR: [XXXX](../adr/XXXX-main-path-budgets-are-a-p95-after-a-warm-up.md) (main path budgets are a p95 after a warm-up)

## Budgets, fixed before measuring

| Path | Budget id | p95 budget | Why this number |
|---|---|---:|---|
| Open a slide to the first fitted image | `app.open-fitted-p95-ms` | 3,000 ms at 50 ms RTT | A user sees the whole slide within three seconds on a good European link. The CI limit at 200 ms RTT is 6,300 ms. |
| Jump to a sharp viewport | `app.jump-sharp-p95-ms` | 2,500 ms at 50 ms RTT | About twelve round trips plus decode. At 200 ms RTT the hosted baseline is 2,928 ms, of which about 2,400 ms is round trips. |
| Import 10,000 cells | `app.import-10k-cells-p95-ms` | 5,000 ms | A small result set is ready before the user has gone back to the slide list. |
| Import 1,000,000 cells | `app.import-1m-cells-p95-ms` | 60,000 ms | The 1.6 million cell file took 42 to 45 s in the bounded import result of 2026-11-01, so a million cells must stay within a minute. |
| Model run on a whole slide | `app.model-run-stand-in-s-per-mm2` | 2.0 s/mm2 | The catalogue gives the nuclei model 17 minutes per slide, about 10 s/mm2 for 100 mm2 of tissue. The work around the model may take at most a fifth of that. |
| Decision to the next object on screen | `app.decision-next-object-p95-ms` | 100 ms | The limit of a response that feels instant, half the 200 ms a good interaction to next paint allows. |

TODO: method, machine, numbers.
