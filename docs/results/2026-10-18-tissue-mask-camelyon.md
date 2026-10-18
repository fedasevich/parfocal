# Result: tissue mask on CAMELYON16

- Date: 2026-10-18
- Backlog: INGEST-012 (tissue mask)
- Kind: ML evaluation
- Commit: the INGEST-012 commit on top of `84a1a9e` (`parfocal_ingest.tissue`)
- Environment: Apple M4, macOS 15.8.1, Python 3.14, OpenSlide 4.0.1, Pillow 13.0.0, numpy 2.5.4
- Data: CAMELYON16 `tumor_009.tif` and `test_001.tif` with their ASAP annotation XML (the `camelyon` fixture group)

## Question

Does an Otsu threshold on HSV saturation, on a grid of 64 level-0 pixel cells, cover more than 98% of the annotated tumour and leave the glass out, as INGEST-012 asks?

## Method

`tissue_mask` reads the coarsest level with a downsample of at most 64 through the reader of record, box-resizes it to one pixel per 64×64 cell, thresholds saturation at `max(otsu, 20)` and grows the result by one cell (a 3×3 maximum filter). Tumour cells are the ASAP polygons in group `Tumor` drawn on the same grid. Glass cells are cells whose darkest channel is above 220. Run with `PARFOCAL_REQUIRE_FIXTURES=camelyon uv run pytest workers/ingest/tests/test_tissue.py`, and the numbers below came from the same helpers.

## Results

| Slide | Grid (rows × cols) | Threshold | Tissue cells | Tumour cells | Tumour covered | Glass cells | Glass marked |
|---|---|---:|---:|---:|---:|---:|---:|
| tumor_009.tif | 3392 × 1528 | 37 | 11.40% | 209,539 | 99.30% | 4,458,323 | 0.64% |
| test_001.tif | 1400 × 1344 | 65 | 19.47% | 25,842 | 99.71% | 1,029,047 | 1.23% |

Without the one-cell margin the same threshold covered 97.74% (tumor_009) and 97.50% (test_001) of the tumour and marked 0.00% of the glass.

## Interpretation

The plain threshold misses a rim of tumour cells at the tissue edge, where a 64 px cell is half glass. The one-cell margin fixes that for about 1% of the glass, which is cheap for coverage tracking and job planning. The glass rule (darkest channel above 220) is an assumption of this check, not a ground truth. Two slides are a small sample.

## Follow-ups

- The masks are kept as goldens in `workers/ingest/tests/golden/tissue`. The `camelyon` group does not run in CI, so the check runs on a machine that has it.
- TODO: a small segmentation model, if pale tissue such as fat turns out to matter for coverage. The INGEST-012 line allows Otsu or a model.
