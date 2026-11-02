# Result: tumor areas port on tumor_009, a training slide

- Date: 2026-11-02
- Backlog: AITUM-003 (areas from the tumor map)
- Kind: baseline
- Commit: the AITUM-003 commit on top of 15c3f61
- Environment: MacBook, arm64, macOS 15, Python 3.14 through uv, CPU only
- Data: the POC's stored MONAI tumor map `public/data/heatmaps/tumor_009.tumor.json` (382 by 848 cells of 256 px, max pooled, bytes over 255) and the CAMELYON16 outlines `public/data/camelyon/Tumor_009.json`, both in the local POC checkout

## Question

Does the Python port in `workers/ml/src/parfocal_ml/tumor_areas.py` give the POC's numbers from doc 36 (sentinel node areas): 7 areas for 6 deposits and 8.1 mm found against 8.1 mm annotated for the largest deposit? This is not the CAMELYON16 test slide evaluation the task asks for.

## Method

Decode the stored map, divide by 255, call `find_tumor_areas` with the extent `[0, 0, 97792, 217088]`, 0.2439 µm per pixel, the outline at 0.5, listing from a 0.97 peak and the packaged ±10% range. Match with `evaluate_areas` with a pad of one cell (256 px), the POC script's rule: an area belongs to a deposit when their boxes overlap. `test_reproduces_the_poc_on_tumor_009` in `workers/ml/tests/test_tumor_areas.py` repeats the check and skips when the POC is absent.

## Results

Areas found, largest first: 8.05, 6.29, 1.49, 0.98, 0.93, 0.58 and 0.20 mm, that is 7 areas. Two are macro, four micro and one isolated tumor cells. Only the 0.20 mm area is near a line, and none is too small for the map.

| Annotated deposit size | Its category | Largest area over it | Areas over it |
| --- | --- | --- | --- |
| 8.06 mm | macro | 8.05 mm | 1 |
| 6.38 mm | macro | 6.29 mm | 2 |
| 1.53 mm | micro | 1.49 mm | 2 |
| 1.04 mm | micro | 0.93 mm | 1 |
| 0.42 mm | micro | 6.29 mm | 1 |
| 0.42 mm | micro | 1.49 mm | 1 |

Areas over no annotated deposit: 0.98 mm and 0.58 mm.

## Interpretation

The port reproduces the POC: 7 areas, 8.1 mm against 8.1 mm, and the same 6.3, 1.5 and 0.93 mm sizes. The two 0.42 mm deposits merge with larger neighbours, as in the POC. This is a training slide, so it shows the port is faithful, not that the sizes generalise.

## Follow-ups

TODO: the per-deposit size error and stray areas on CAMELYON16 test slides. That needs tumor maps for test slides, which no one has stored. The slides are in the dev bucket since INGEST-028 (upload protocol check on R2), but making a map needs a GPU run of the tumor model, which MLEVAL-005 (tumor map evaluation) will bring. `evaluate_areas` is the harness for it, and the ±10% in `tumor_areas.toml` should then be replaced by the measured error.
