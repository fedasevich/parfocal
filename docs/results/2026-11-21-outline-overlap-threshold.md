# Starting outline overlap for "outline differs"

- Date: 2026-11-21
- Task: PROTO-116 (reviewers' outlines that differ reach the disagreement queue)
- Decision: decision 167 (who settles two different outlines for one object), option A
- Script: [`workers/ingest/benchmarks/measure_outline_overlap.py`](../../workers/ingest/benchmarks/measure_outline_overlap.py), run as `uv run --package parfocal-ingest python -I workers/ingest/benchmarks/measure_outline_overlap.py packages/test-fixtures/model-results`

## Short answer

Two reviewers' outlines of one object count as different when their intersection over union is below **60%**. That is the starting value of the new per task setting `outline_overlap`. At a 600 pixel stage it sits below the 5th percentile of outlines traced within the select tool's hit tolerance and above an outline that covers half the object or sits half its width away, for regions and cells alike. It is a proxy built from AI outlines and app tolerances, not from human pairs.

## What was measured

The fixtures hold AI outlines only. After dropping result files that are byte for byte the same (`cmu-1-jp2k-33005-v2-zip` repeats `cmu-1-jp2k-33005-svs`), there are 55 regions and about 26,600 cells across `packages/test-fixtures/model-results`. No fixture has two people outlining one object, and no two fixture result sets share a slide in one pixel frame (`cmu-1-tiff` and `cmu-1-ndpi` are different scans). So a second outline was made from each fixture outline, at sizes taken from tuned constants of the app, never invented.

- The object is assumed to be on screen as the disagreement card shows it, fitted to twice its long side (`outlineArea` in `apps/web/src/viewer/stage-geometry.ts`) and capped at 16 device pixels per slide pixel (`maxDevicePixelsPerSlidePixel` in the viewer camera).
- A traced boundary counts as "the same line" within 6 screen pixels, the select tool's tuned `hitTolerancePx`. 1.5 screen pixels is the freehand tool's `simplifyToleranceScreenPixels`. Each was turned into slide pixels at the fitted zoom.
- A close redraw is the worst of three: the outline grown by that distance, shrunk by it, or moved sideways by it.
- A far redraw is the outline moved by half its own width, or shrunk to half its area about its centre.
- The overlap is the intersection area over the union area, the same measure the API computes in PostGIS.

Every 5th cell was used. The stage short side was swept over 400, 600 and 900 CSS pixels.

## Numbers, stage 600 CSS pixels

| Kind | Case | 1st pct | 5th pct | Median | 95th pct |
| --- | --- | --- | --- | --- | --- |
| Region | Close, 1.5 px | 0.889 | 0.917 | 0.964 | 0.979 |
| Region | Close, 6 px | 0.574 | 0.673 | 0.859 | 0.918 |
| Region | Moved half its width | 0.016 | 0.054 | 0.175 | 0.273 |
| Region | Half its area | 0.317 | 0.329 | 0.500 | 0.500 |
| Cell | Close, 1.5 px | 0.867 | 0.900 | 0.947 | 0.964 |
| Cell | Close, 6 px | 0.520 | 0.628 | 0.797 | 0.859 |
| Cell | Moved half its width | 0.029 | 0.111 | 0.225 | 0.273 |
| Cell | Half its area | 0.489 | 0.500 | 0.500 | 0.500 |

At 400 CSS pixels the region close 6 px 5th percentile drops to 0.526, and at 900 it rises to 0.780. Cells do not move with the stage, because every fixture cell hits the zoom cap.

In plain slide pixels, without the card's fit, cells and regions behave very differently. A 6 pixel offset leaves a median cell at 0.28 overlap and a median region at 0.90, so one value only works because the card shows both at about the same screen size.

## Why 60%

- At a 600 pixel stage, 95% or more of close redraws at 6 screen pixels stay above 60% for both kinds, and over 99% of redraws within 1.5 pixels do. At a 400 pixel stage more than 5% of region redraws at 6 pixels fall below 60%, because the 5th percentile there is 52.6%.
- An outline half the size (50%) or half a width away (95th percentile 27%) falls below 60%.
- The evaluation's own rule for "the same added region" (`SAME_ADDED` in `apps/api/src/parfocal_api/evaluation.py`) uses 50%. That rule decides whether two outlines are one object at all, so the stricter 60% for "same object, different outline" fits inside it.

## Assumptions and what was not checked

- Reviewers redraw in the review viewer's live card (PROTO-111, reviewers redraw outlines from the live card), whose framing was not read. It is assumed to fit the object like the disagreement card.
- A device pixel ratio of 2 was assumed. At a ratio of 1 the zoom cap doubles in CSS pixels, so cells would read about twice as large and their close overlaps would rise.
- The stage size was swept from 400 to 900 CSS pixels, not read from use.
- No real pair of human outlines was measured. Once reviewers redraw on the deployed app, `review_edits` holds the pairs and the value should be revisited from them.
- A reviewer who keeps the AI outline is not compared with one who redrew. See ADR 0412 (outlines differ below a per task overlap of reviewers' redraws).
