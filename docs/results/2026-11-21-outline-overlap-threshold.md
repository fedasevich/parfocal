# Starting outline overlap for "outline differs"

- Date: 2026-11-21
- Task: PROTO-116 (reviewers' outlines that differ reach the disagreement queue)
- Decision: decision 167 (who settles two different outlines for one object), option A
- Script: [`scripts/measure_outline_overlap.py`](../../scripts/measure_outline_overlap.py), run as `.venv/bin/python -I scripts/measure_outline_overlap.py packages/test-fixtures/model-results`

## Short answer

Two reviewers' outlines of one object count as different when their intersection over union is below **60%**. That is the starting value of the new per task setting `outline_overlap`. It sits below the 5th percentile of outlines traced within the select tool's hit tolerance and above an outline that covers half the object or sits half its width away, for regions and cells alike.

## What was measured

The fixtures hold AI outlines only, 56 regions and about 30,600 cells across the 13 fixture result sets in `packages/test-fixtures/model-results`. No fixture has two people outlining one object, and no two fixture result sets share a slide in the same pixel frame (`cmu-1-jp2k-33005-svs` and `cmu-1-jp2k-33005-v2-zip` are byte for byte the same, and `cmu-1-tiff` and `cmu-1-ndpi` are different scans). So a second outline was made from each fixture outline, at sizes taken from tuned constants of the app, never invented.

- The reviewer sees the object on the card fitted to twice its long side (`outlineArea` in `apps/web/src/viewer/stage-geometry.ts`), capped at 16 device pixels per slide pixel (`maxDevicePixelsPerSlidePixel` in the viewer camera), at a device pixel ratio of 2.
- A traced boundary counts as "the same line" within 6 screen pixels, the select tool's tuned `hitTolerancePx`, and 1.5 screen pixels is the freehand tool's `simplifyToleranceScreenPixels`. Each was turned into slide pixels at the fitted zoom.
- A close redraw is the worst of three: the outline grown by that distance, shrunk by it, or moved sideways by it.
- A far redraw is the outline moved by half its own width, or shrunk to half its area about its centre.
- The overlap is the intersection area over the union area, the same measure the API computes in PostGIS.

The stage short side was taken as 400, 600 and 900 CSS pixels to see how much the viewport matters. Every 5th cell was used.

## Numbers, stage 600 CSS pixels

| Kind | Case | 1st pct | 5th pct | Median | 95th pct |
| --- | --- | --- | --- | --- | --- |
| Region | Close, 1.5 px | 0.889 | 0.917 | 0.966 | 0.979 |
| Region | Close, 6 px | 0.574 | 0.673 | 0.866 | 0.918 |
| Region | Moved half its width | 0.016 | 0.054 | 0.185 | 0.273 |
| Region | Half its area | 0.317 | 0.329 | 0.500 | 0.500 |
| Cell | Close, 1.5 px | 0.867 | 0.900 | 0.945 | 0.964 |
| Cell | Close, 6 px | 0.515 | 0.628 | 0.788 | 0.859 |
| Cell | Moved half its width | 0.028 | 0.115 | 0.224 | 0.273 |
| Cell | Half its area | 0.490 | 0.500 | 0.500 | 0.500 |

At 400 CSS pixels the region close 6 px 5th percentile drops to 0.526, and at 900 it rises to 0.780. Cells do not move with the stage, because every fixture cell hits the zoom cap.

In plain slide pixels, without the card's fit, cells and regions behave very differently. A 6 pixel offset leaves a median cell at 0.28 overlap and a median region at 0.90, so one value only works because the card shows both at about the same screen size.

## Why 60%

- 95% or more of close redraws at 6 screen pixels stay above 60% for both kinds at a 600 pixel stage, and over 99% of redraws within 1.5 pixels do.
- An outline half the size (50%) or half a width away (95th percentile 27%) falls below 60%.
- The evaluation's own rule for "the same added region" (`SAME_ADDED` in `apps/api/src/parfocal_api/evaluation.py`) uses 50%. That rule decides whether two outlines are one object at all, so the stricter 60% for "same object, different outline" fits inside it.

## What was not checked

- No real pair of human outlines was measured. When reviewers redraw on the deployed app, `review_edits` holds the pairs, and the same script idea should be run on them to revisit the value.
- The stage size was an assumption swept from 400 to 900 CSS pixels, not read from use.
- A reviewer who keeps the AI outline is not compared with one who redrew. See ADR 0412 (outlines differ below a per task overlap of reviewers' redraws).
