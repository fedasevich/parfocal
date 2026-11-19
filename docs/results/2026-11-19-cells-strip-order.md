# Result: the cells strip follows the tissue and the camera stays put inside a cluster

- Date: 2026-11-19
- Backlog: PROTO-063 (arrow keys move between cells in the sample cells strip)
- Kind: benchmark, computed from cell positions with no browser
- Commit: the PROTO-063 follow-up commit on top of `318bd3af`
- Environment: Apple M4, macOS 15.8.1, Node 26.13.1
- Data: the three outlined cells of the fake API stage slide, the twelve cells of the prototype field, and five synthetic samples from a fixed seed. No PHI

## Question

The owner asked that stepping through the sampled cells does not throw the doctor across the slide on each step when the cells are close or clustered. Which strip order gives the least camera travel while staying the same for the same sample, and how much does a camera that stays put help?

## Where the order came from

The strip showed the cells in the review order the server stores per task slide ([ADR 0117](../adr/0117-review-order-is-stored-per-task-slide.md), review order stored per task slide). That order is least sure first by default, or bands of 2048 px that snake across the slide when the task turns least sure first off. Which cells are in a random sample is a seeded draw on the server (`CellPool.sample` in `packages/py-common/src/parfocal_common/review_order.py`), and that draw is not touched here. Only the order the strip shows the drawn cells in changes, in the browser.

## Method

`node docs/results/2026-11-19-cells-strip-order/measure.ts` prints every table below. It imports the shipped `tissueOrder`, `bandOrder` and `calmStep`, so it measures the code that runs in the app.

- Orders compared: as served, the server's bands of 2048 px, a Hilbert curve over the cell centres, a nearest neighbour tour from the top left cell, and the chosen rule.
- The chosen rule groups cells that chain together within 320 slide px, tours the groups from the top left one (nearest neighbour, then 2-opt), enters each group at the cell nearest to where the last group ended and tours inside it the same way. Cells are sorted by id first, so the served order cannot change the result. Above 600 cells it falls back to the bands.
- "As served" for the synthetic samples is a seeded shuffle. Assumption: it stands in for least sure first, whose order has nothing to do with position.
- Camera travel is in screen widths per step for a stage of 1100 by 800 px with a strip 190 px tall. Scale is 2 screen px per slide px for the two fixtures and 1 for the synthetic samples, whose cells are 24 slide px wide on a slide of 20000 by 15000 px.
- "Always centre" moves the camera to every cell, as the app did. "Calm" leaves the camera alone when the cell is inside the inner 65% of the view above the strip, and otherwise centres the cell above the strip at the same zoom.

## Results

### Fake API stage cells (3)

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 470 | 0.43 | 0.44 | 0.45 | 0% |
| bands of 2048 px | 546 | 0.50 | 0.54 | 0.63 | 0% |
| Hilbert curve | 546 | 0.50 | 0.54 | 0.63 | 0% |
| nearest neighbour | 470 | 0.43 | 0.44 | 0.45 | 0% |
| clusters, then tour (chosen) | 470 | 0.43 | 0.44 | 0.45 | 0% |

### Prototype field cells (12)

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 9466 | 0.35 | 0.32 | 1.19 | 24% |
| bands of 2048 px | 18890 | 0.70 | 0.68 | 1.49 | 16% |
| Hilbert curve | 3916 | 0.15 | 0.07 | 0.79 | 80% |
| nearest neighbour | 3519 | 0.13 | 0.09 | 1.19 | 76% |
| clusters, then tour (chosen) | 2783 | 0.10 | 0.07 | 0.39 | 78% |

### Synthetic clustered 12, 3 groups

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 44071 | 3.64 | 3.62 | 9.63 | 36% |
| bands of 2048 px | 12998 | 1.07 | 0.99 | 9.15 | 64% |
| Hilbert curve | 12467 | 1.03 | 1.00 | 9.47 | 55% |
| nearest neighbour | 12039 | 0.99 | 0.96 | 9.36 | 64% |
| clusters, then tour (chosen) | 12039 | 0.99 | 0.96 | 9.36 | 64% |

### Synthetic clustered 50, 6 groups

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 216533 | 4.02 | 4.01 | 9.07 | 8% |
| bands of 2048 px | 26825 | 0.50 | 0.46 | 4.89 | 47% |
| Hilbert curve | 32928 | 0.61 | 0.56 | 5.28 | 61% |
| nearest neighbour | 23340 | 0.43 | 0.39 | 4.65 | 57% |
| clusters, then tour (chosen) | 22854 | 0.42 | 0.37 | 4.65 | 63% |

### Synthetic clustered 200, 12 groups

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 1568136 | 7.16 | 7.16 | 15.50 | 3% |
| bands of 2048 px | 121033 | 0.55 | 0.52 | 11.76 | 50% |
| Hilbert curve | 91556 | 0.42 | 0.37 | 10.20 | 61% |
| nearest neighbour | 63989 | 0.29 | 0.25 | 5.75 | 64% |
| clusters, then tour (chosen) | 63275 | 0.29 | 0.26 | 5.95 | 63% |

### Synthetic uniform 50

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 392799 | 7.29 | 7.29 | 16.79 | 0% |
| bands of 2048 px | 138562 | 2.57 | 2.57 | 15.25 | 2% |
| Hilbert curve | 116723 | 2.17 | 2.16 | 7.60 | 2% |
| nearest neighbour | 105585 | 1.96 | 1.95 | 10.15 | 2% |
| clusters, then tour (chosen) | 96350 | 1.79 | 1.78 | 6.22 | 2% |

### Synthetic uniform 200

| Order | Path, slide px | Always centre, widths per step | Calm, widths per step | Calm, longest step | Calm, steps with no move |
| --- | ---: | ---: | ---: | ---: | ---: |
| as served | 1846635 | 8.44 | 8.44 | 20.22 | 0% |
| bands of 2048 px | 236961 | 1.08 | 1.08 | 6.17 | 7% |
| Hilbert curve | 257531 | 1.18 | 1.17 | 8.37 | 9% |
| nearest neighbour | 235784 | 1.08 | 1.07 | 15.04 | 10% |
| clusters, then tour (chosen) | 195062 | 0.89 | 0.88 | 3.94 | 10% |

## Interpretation

- The order does most of the work. On the five synthetic samples the chosen order cuts camera travel per step to between 4% and 27% of the shuffled order (always centre: 7.16 to 0.29 widths on 200 clustered cells at best, 3.64 to 0.99 on 12 clustered cells at worst).
- The chosen rule has the shortest or near shortest path on every sample. Its gain over a plain nearest neighbour tour shows on the spread out samples, where it also removes the long return trips for cells the greedy tour left behind (longest step 15.04 against 3.94 widths on 200 uniform cells).
- Bands and the Hilbert curve are stable but split clusters that straddle a band or a curve cell, which is the teleporting the owner described.
- The calm camera hardly changes the distance. What it changes is how often the view moves at all: with the chosen order 63 to 78% of steps in the clustered samples and the prototype field leave the camera still, and the cells that are far apart still cost one move each.
- The three fake API cells are too few and too far apart to show a difference. Their order stays C1, C2, C3.
- Assumption: the synthetic samples are not real tissue. Real nuclei samples drawn at random from a slide with a few tumour areas should sit between the clustered and the uniform cases.

## Follow-ups

- The strip order is a display rule in the browser and takes one function to undo, so no ADR was written. Guided review still steps through objects in the stored review order.
- `TODO`: the first flight to a cell still fits the view to twice the cell's size, up to the engine's zoom limit. On the fake slide that is 16 screen px per slide px, which is closer than a doctor would choose. A fixed landing magnification for cells is a product choice for the owner.
- `TODO`: the prototype scenes in `apps/web/src/screens/viewer` and `apps/web/src/screens/review` keep the served order and the jump to the nearest cell.
