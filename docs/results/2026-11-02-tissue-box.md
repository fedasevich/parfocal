# Result: tissue box that ignores specks

- Date: 2026-11-02
- Backlog: INGEST-027 (tissue box that ignores specks)
- Kind: ML evaluation
- Commit: the INGEST-027 commit on top of `bf9351c` (`parfocal_ingest.tissue.box_of`)
- Environment: Apple M4, macOS 15.8.1, Python 3.14.7, scipy and numpy from the workspace lock
- Data: `CMU-1.svs` (the `formats` group) and CAMELYON16 `tumor_009.tif` and `test_001.tif` with their ASAP annotation XML (the `camelyon` group)

## Question

Does a bounding box over the mask's large connected regions come out tighter than the box over all tissue cells, and still hold more than 98% of the annotated tumour, as INGEST-027 asks?

## Method

The INGEST-012 mask (64 px cells, grown by one cell) is labelled into 8-connected regions with `scipy.ndimage.label`. A region is a speck when it holds less than 0.1% of all tissue cells (`SPECK_SHARE`). The box is the union of the remaining regions, in level-0 pixels, clipped to the level-0 size. If every region is a speck, which happens only with more than a thousand similar pieces, all regions are kept. The box is written as `box` (`x`, `y`, `width`, `height`, or `null` for no tissue) in `tissue.json` beside `cell`, `threshold` and `fraction`, the same shape as the viewer's `SlideArea`. Run with `PARFOCAL_REQUIRE_FIXTURES=camelyon,formats,small uv run pytest workers/ingest/tests/test_tissue.py`, and the table came from the same helpers.

## Results

| Slide | Level 0 | Regions | All-cells box (x, y, size) | Box (x, y, size) | Box area of all-cells | Tissue cells in box | Tumour in box |
|---|---|---:|---|---|---:|---:|---:|
| CMU-1.svs | 46000 x 32914 | 37 | 1856, 256, 42816 x 31104 | 2432, 1024, 42240 x 30336 | 96.2% | 99.98% | no annotation |
| tumor_009.tif | 97792 x 217088 | 1002 | 1664, 6016, 94016 x 209088 | 11584, 67520, 81216 x 111360 | 46.0% | 99.52% | 100.0% |
| test_001.tif | 86016 x 89600 | 907 | 2112, 3008, 83904 x 85632 | 4032, 3008, 78144 x 82624 | 89.9% | 99.97% | 100.0% |

Every region touching an edge of the all-cells box was 9 to 25 cells on all three slides, apart from one 1904-cell fragment on test_001 that is real tissue and stays in. The box was the same for every share from 0.05% to 0.5%. At 1% test_001 lost a 3227-cell fragment and at 5% an 8658-cell one, about 1 to 1.5 mm across.

## Interpretation

0.1% sits in the middle of the stable range, well clear of real fragments, so the box leans to showing too much, as the owner prefers for the fit ([ADR 0110](../adr/0110-native-jpeg-decode-and-tissue-fit.md), native JPEG decode and the tissue fit). CMU-1.svs gains little because its tissue really reaches near the edges. The rule is relative, so a slide with one very large section and a small separate biopsy fragment under 0.1% of the tissue would leave that fragment outside the box. The fit only moves the camera, so the fragment is still one zoom-out away. Three slides are a small sample.

## Follow-ups

- VIEW-049 (deliver the tissue box to the viewer) reads `box` from `tissue.json` and passes it as `EngineSlide.tissue`.
- Slides ingested before this change have no `box` until they are re-ingested.
