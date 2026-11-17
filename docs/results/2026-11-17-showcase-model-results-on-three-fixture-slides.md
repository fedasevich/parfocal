# Result: real model results for the showcase seed on crops of three fixture slides

- Date: 2026-11-17
- Backlog: TEST-047 (the demo seed carries real model results made on the owner's Mac)
- Kind: ML run for seed data
- Commit: the TEST-047 commit on top of `746b18f6` (`workers/ml/spike/showcase_results_run.py`, `apps/api/src/parfocal_api/showcase_results.py`, `packages/test-fixtures/model-results/`)
- Environment: Apple M4 with 24 GB, macOS 15.8.1, the worktree's uv environment (Python 3.14, torch 2.15.0 on CPU, onnxruntime 1.31.1 on `CPUExecutionProvider`, openslide-python), shared with other agents' runs. One model process at a time under `nice -n 10`, free memory checked before each slide (71%, 72% and 75%)
- Data: `test_065.tif` (CAMELYON16 test slide, CC0), `CMU-1-Small-Region.svs` and `Philips-4.tiff` (OpenSlide test data), all from the fixture cache
- Weights: InstanSeg `instanseg_models_v0.1.1/brightfield_nuclei` TorchScript, SHA-256 `0c724da169d507d8dd2e206ad3675a0b1566824eee6e20ad9a0ba916311d9dd0`. HoVer-NeXt PanNuke typer ONNX, SHA-256 `fdf65836a8971a989fd34b76ba5698bfa1b6bc91ca921b5a6accaaff91e9593d`. MONAI `pathology_tumor_detection` 0.6.4 ResNet18 as ONNX (`camelyon-tumor.onnx`), SHA-256 `9f5e526f6b4f6dd3c9a58df9d40a4ce600a4a97e854ee9b77165a18d6e2400f1`

## Question

Can the models the ML worker already wraps make real cells and tumour regions for the demo slides on the owner's Mac, small enough to commit, and how long does each take?

## Method

```
uv sync --package parfocal-ml --extra export --extra tumor --inexact
PYTHONPATH=workers/ml/spike nice -n 10 uv run --no-sync --package parfocal-ml python \
  workers/ml/spike/showcase_results_run.py ~/.cache/parfocal/fixtures/test_065.tif out/test_065 \
  --regions --map-box 646 360 710 424
... CMU-1-Small-Region.svs out/CMU-1-Small-Region
... Philips-4.tiff out/Philips-4 --regions
```

1. Tumour regions: the tumour map of AITUM-001 (tumor map job) with the ONNX scorer the deployed pool uses, over a box of 2 by 2 tiles (64 by 64 cells of 64 px, 4,096 px a side) at level 0. On `test_065` the box sits over the deposit the cached whole-slide map of MLEVAL-005 (tumor map evaluation) found, and on `Philips-4` it is the box with the most tissue. Areas are cells at or above `OUTLINE_AT` (0.5) joined with 8-connectivity, kept when their peak reaches `LISTED_FROM_PEAK` (0.97), outlined by `find_contours` on the cell grid and written as `regions.parfocal.json`.
2. Cells: one crop of 2,048 by 2,048 px at level 0, centred on the regions box, or the densest tissue box on `CMU-1-Small-Region`, where the crop is cut to 2,048 by 2,007 px by the slide's lower edge. InstanSeg segments the crop resized to 0.5 µm/px, the labels are scaled back, each nucleus is outlined inside its own bounding box and simplified with a 1 px tolerance. The typer then types each nucleus in windows of 1,024 typer pixels at 0.25 µm/px with a 32 px margin, with the project's default mapping (PanNuke epithelial counts as other). Written as `cells.geojson`.
3. Each run's numbers are in `run.json` beside its files. Every timing below is from the final run of each slide.
4. Alignment check: an overlay of the crop with every outline drawn was looked at for `test_065` and `Philips-4`. Nuclei outlines sit on the nuclei, and the `test_065` region follows the edge of the tumour cluster.

## Results

| Slide | µm/px | Cells crop, level 0 px | Model input px | Cells | Tumor | Stroma | Immune | Other |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| test_065 | 0.226 | 42,368 to 44,416 across, 24,064 to 26,112 down | 927 | 2,038 | 24 | 747 | 586 | 681 |
| CMU-1-Small-Region | 0.499 | 0 to 2,048 across, 960 to 2,967 down | 2,044 by 2,003 | 1,418 | 64 | 919 | 197 | 238 |
| Philips-4 | 0.25 | 75,904 to 77,952 across, 41,024 to 43,072 down | 1,024 | 5,719 | 15 | 687 | 5,017 | 0 |

| Slide | Regions box, level 0 px | Tiles | Areas at 0.5 | Regions kept | Region peak | Region size |
|---|---|---:|---:|---:|---:|---|
| test_065 | 41,344 to 45,440 across, 23,040 to 27,136 down | 4 | 3 | 1 | 1.000 | 381 cells, 1,408 by 2,176 px |
| Philips-4 | 74,880 to 78,976 across, 40,000 to 44,096 down | 4 | 6 | 1 | 0.977 | 24 cells, 576 by 256 px |

| Slide | Tumour map s | Segment s | Outlines s | Typer s, windows | Wall s | Peak resident GB |
|---|---:|---:|---:|---:|---:|---:|
| test_065 | 3.4 | 10.9 | 2.0 | 6.2, 4 | 30.6 | 4.32 |
| CMU-1-Small-Region | | 63.2 | 4.5 | 88.8, 13 | 168.3 | 6.42 |
| Philips-4 | 9.0 | 28.4 | 7.5 | 10.0, 4 | 72.2 | 4.39 |

Files committed under `packages/test-fixtures/model-results/`, 4.1 MB in all:

| Folder | cells.geojson bytes | regions.parfocal.json bytes |
|---|---:|---:|
| test-065 | 1,085,602 | 2,288 |
| cmu-1-small-region | 517,758 | |
| philips-4 | 2,626,885 | 626 |

## Interpretation

- The `test_065` region covers the same 381 cells as the deposit the whole-slide map found, and it lies over an annotated CAMELYON16 deposit. It is a true detection.
- `Philips-4` is lymphoid tissue, and its one region has no reference outline, so whether it is right is unknown. The typer calls 88% of its cells immune, which fits the overlay.
- On `test_065` the typer calls most cells inside the tumour cluster other, because the project maps PanNuke epithelial to other unless the tissue is one of the epithelial tumour tissues listed in `typer.py`. A lymph node is not listed. This is the real output and was not changed for the demo.
- `CMU-1-Small-Region` has no regions file. It is not lymph node tissue and is scanned at 0.499 µm/px, about twice the 0.243 µm/px the tumour model was trained at, so the map would not be meaningful there. The seed keeps the drawn regions for it.
- A first `test_065` run outlined nuclei with `instanseg.rings_of`, which scans the whole label image once per nucleus and took 137.1 s for 2,038 nuclei. Outlining inside each nucleus's bounding box took 2.0 s for the same nuclei, so the spike uses that.
- The seed imports these files for `test_065`, `CMU-1-Small-Region.svs` and `Philips-4.tiff`. Every other gallery slide keeps the drawn shapes of `showcase_shapes.py`.

## Conclusion

The three slides have real cells and two have real tumour regions. A slide took 31 to 168 s on a shared CPU, and peak memory stayed under 6.5 GB. The deployed demo shows them after the next production reset. The files total 4.1 MB, so they are committed.
