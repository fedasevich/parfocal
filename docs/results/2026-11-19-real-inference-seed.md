# Result: every seeded AI result comes from real inference on crops of the fixture slides

- Date: 2026-11-19
- Backlog: TEST-051 (every seeded AI result comes from real inference)
- Kind: ML run for seed data
- Commit: the TEST-051 commit on top of `1912ecfc` (`workers/ml/spike/showcase_results_run.py`, `apps/api/src/parfocal_api/showcase*.py`, `packages/test-fixtures/model-results/`)
- Environment: Apple M4 with 24 GB, macOS 15.8.1, the worktree's uv environment (Python 3.14, torch on CPU, onnxruntime on `CPUExecutionProvider`, OpenSlide 4.0.1), shared with other agents' runs. One model process at a time under `nice -n 10`. System free memory was 49 to 67% before each slide
- Data: the OpenSlide test slides of the format gallery from the fixture cache. `CMU-1-JP2K-33005-v2.zip` was unzipped and opened as DICOM through `DCM_0.dcm`
- Weights: the same three files as TEST-047 (the demo seed carries real model results made on the owner's Mac), listed with their SHA-256 in [the earlier result](2026-11-17-showcase-model-results-on-three-fixture-slides.md)
- Cost: $0. Every run was local, and Modal was not used

## Question

Can every AI result the showcase seed creates come from the cell, typer and tumour region models, run on small crops of the seeded slides on the owner's Mac, and how long does each slide take?

## What the seed creates

Before this change the seed created AI results in two places, and only three slides had real ones.

1. The format gallery tour (`add_demo_sets`) gave each of the 15 gallery slides, `test_065` and the 14 `FORMAT_GALLERY` files, a "Tumour detector v1" regions set and a "Cell typer v1" cells set. `test_065`, `CMU-1-Small-Region.svs` (cells only) and `Philips-4.tiff` used TEST-047's files. The other sets were three drawn squares and a grid of 24 drawn cells from `showcase_shapes.py`.
2. The study projects' state and style cases (`ready_set`), "Case ready" to "Case uploaded", "Case agree style" and the others, plus the running import on "Case ai-running", each got three drawn rectangles from `sample_project.square`, on slides taken from the CAMELYON16 sample files or the four smallest stored gallery files.

Human annotations, decisions, opinions and the failed "Broken import" set hold no model output and stay as they were.

After this change:

1. Each gallery slide gets a regions set only when its `regions.parfocal.json` exists and a cells set only when its `cells.geojson` exists. `showcase_shapes.py` is deleted.
2. The state and style cases are taken only from gallery files with real regions, the four smallest stored ones, and their sets carry those regions. The CAMELYON16 samples `tumor_001` to `tumor_003` and `normal_001` are not in the fixture cache, and reading them from R2 was out of bounds, so these cases no longer use them.
3. `test_every_seeded_ai_result_comes_from_a_model_run` in `apps/api/tests/test_showcase.py` fails if any seeded set is not labelled with one of the two model names, if a cells set's count matches no model file, or if any stored region outline is not one of the outlines in `packages/test-fixtures/model-results/`.

## Method

```
uv sync --all-packages --all-extras
PYTHONPATH=workers/ml/spike nice -n 10 uv run --no-sync --package parfocal-ml python \
  workers/ml/spike/showcase_results_run.py SLIDE OUT --regions --any-area --dense-crop --map-tiles 4 [--mpp 0.499]
```

The spike of TEST-047 gained five options.

1. `--map-tiles 4` maps a box of 4 by 4 tiles (128 by 128 cells of 64 px) on the densest tissue instead of 2 by 2, which gives the tumour map more tissue to find an area in.
2. The tumour model was trained at about 0.243 µm/px. On a slide coarser than 1.2 times that, the map reads level 0 and scales it up by the slide's µm/px over 0.243 (the scale column), so the model sees cells at its own resolution. Outlines are scaled back to level 0.
3. `--any-area` keeps every area at or above `OUTLINE_AT` (0.5) when none reaches `LISTED_FROM_PEAK` (0.97). The column "kept from" says which rule applied.
4. `--dense-crop` places the 2,048 px cells crop on the densest tissue box instead of the centre of the map box, whose centre fell on empty glass on the first `JP2K-33003-1` try (23 cells).
5. `--mpp 0.499` overrides `CMU-1.tiff`, whose generic TIFF header says 1,000 µm/px. It is the same scan as `CMU-1.svs` at 0.499.

The densest tissue box is now clipped to the slide, which matters only for `CMU-1-Small-Region`, smaller than one map box. Its first run wrote outlines at negative x and was run again. Files from every slide's final run are in `packages/test-fixtures/model-results/<label>/`, with that run's numbers in `run.json`. The folder name now keeps the file extension (`cmu-1-ndpi`, `cmu-1-tiff`), because `CMU-1.ndpi` and `CMU-1.tiff` would otherwise share `cmu-1`. TEST-047's two gallery folders were renamed to match.

Cells on the `CMU-1.ndpi` crop were looked at in its overlay, and the outlines sit on the nuclei.

## Results

| Slide | µm/px | Cells crop, level 0 px | Cells | Regions | Map scale | Kept from | Tiles | Map s | Segment s | Typer s | Bytes |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| test_065.tif (TEST-047) | 0.226 | 42,368 to 44,416 across, 24,064 to 26,112 down | 2,038 | 1 | 1.00 | 0.97 | 4 | 3.4 | 10.9 | 6.2 | 1,087,890 |
| Philips-4.tiff (TEST-047) | 0.250 | 75,904 to 77,952 across, 41,024 to 43,072 down | 5,719 | 1 | 1.00 | 0.97 | 4 | 9.0 | 28.4 | 10.0 | 2,627,511 |
| CMU-1-Small-Region.svs | 0.499 | 0 to 2,048 across, 960 to 2,967 down | 1,418 | 6 | 2.05 | 0.5 | 7 | 20.9 | 101.8 | 62.9 | 519,941 |
| JP2K-33003-1.svs | 0.250 | 9,088 to 11,136 across, 11,328 to 13,376 down | 223 | 11 | 1.00 | 0.5 | 14 | 13.0 | 5.7 | 5.4 | 111,331 |
| CMU-1-JP2K-33005.svs | 0.499 | 27,520 to 29,568 across, 4,160 to 6,208 down | 3,982 | 1 | 2.05 | 0.97 | 16 | 12.0 | 35.2 | 27.5 | 1,532,458 |
| CMU-1.ndpi | 0.456 | 30,208 to 32,256 across, 3,840 to 5,888 down | 2,873 | 5 | 1.88 | 0.97 | 16 | 13.7 | 24.6 | 24.3 | 1,131,459 |
| Leica-1.scn | 0.500 | 17,088 to 19,136 across, 40,448 to 42,496 down | 603 | 4 | 2.06 | 0.97 | 16 | 12.6 | 25.8 | 26.2 | 231,968 |
| OS-1.bif | 0.233 | 19,712 to 21,760 across, 1,856 to 3,904 down | 26 | 15 | 1.00 | 0.97 | 16 | 16.1 | 3.3 | 5.3 | 48,052 |
| Philips-3.tiff | 0.227 | 45,568 to 47,616 across, 14,080 to 16,128 down | 4,393 | 0 | 1.00 | 0.5 | 16 | 13.2 | 7.4 | 5.2 | 2,157,051 |
| Huron-1-40x.tif | 0.200 | 1,728 to 3,776 across, 8,256 to 10,304 down | 386 | 2 | 1.00 | 0.97 | 16 | 13.3 | 3.1 | 4.2 | 257,072 |
| Argos-1.avs | 0.383 | 118,464 to 120,512 across, 8,576 to 10,624 down | 2,017 | 6 | 1.58 | 0.97 | 12 | 9.3 | 13.8 | 15.6 | 872,401 |
| CMU-1.tiff | 0.499 | 28,800 to 30,848 across, 2,112 to 4,160 down | 2,965 | 3 | 2.05 | 0.97 | 16 | 14.0 | 39.6 | 29.6 | 1,139,491 |
| CMU-1-JP2K-33005-v2.zip | 0.499 | 27,520 to 29,568 across, 4,160 to 6,208 down | 3,982 | 1 | 2.05 | 0.97 | 16 | 15.6 | 33.0 | 26.2 | 1,532,458 |
| CMU-1-Saved-1_16.zip | 3.717 | no run | | | | | | | | | |
| synthetic-zlib.ome.tiff | | no run | | | | | | | | | |

The two TEST-047 rows are copied from that result for completeness. Their regions used the 0.97 rule without the fallback.

| Slide | Wall s | Peak resident GB |
|---|---:|---:|
| JP2K-33003-1.svs | 30.8 | 3.35 |
| CMU-1-JP2K-33005.svs | 83.3 | 6.54 |
| CMU-1.ndpi | 70.4 | 6.25 |
| Leica-1.scn | 71.3 | 7.31 |
| OS-1.bif | 31.1 | 4.66 |
| Philips-3.tiff | 34.0 | 4.46 |
| Huron-1-40x.tif | 26.2 | 3.81 |
| Argos-1.avs | 45.3 | 7.04 |
| CMU-1.tiff | 91.1 | 6.64 |
| CMU-1-JP2K-33005-v2.zip | 86.2 | 7.18 |
| CMU-1-Small-Region.svs | 219.9 | 6.37 |

The kept runs took 789.6 s of wall time. Two discarded runs, the first `JP2K-33003-1` try (56.2 s) and the first `CMU-1-Small-Region` run (60.1 s), bring the total to 905.9 s, about 15 minutes. The `CMU-1-Small-Region` rerun took longer than its first run (60.1 s) because other agents were using the CPU at the time. The model results folder now holds 13 MB, of which 9.0 MB is new.

## Interpretation

- `CMU-1-Saved-1_16.zip` is a MIRAX scan saved at 3.72 µm/px, where a nucleus is about two pixels wide, so neither model can work on it. `synthetic-zlib.ome.tiff` is a generated grey test pattern with no tissue. Both now get no AI results, and both stay in the gallery as format checks.
- `Philips-3.tiff` had no area at 0.5 in its mapped box, so it gets cells only.
- Only `test_065` is lymph node tissue with a known tumour deposit. The other slides are not what the tumour model was trained on, so their regions are real model output with unknown correctness. They are not ground truth.
- `CMU-1-JP2K-33005.svs` and its DICOM copy give the same cells and region, which shows the two formats decode to the same pixels.
- `OS-1.bif` and `JP2K-33003-1.svs` crops are sparse (26 and 223 cells), because their densest tissue box at the map's cell size still holds little tissue.
- The state and style cases in the deployed app now show gallery fixture slides instead of the CAMELYON16 samples. Making the CAMELYON16 samples carry real results needs `tumor_001` to `tumor_003` and `normal_001` on the Mac, or a Modal run that reads them from R2, and neither was done here.
- The "Sample · sentinel nodes" project that a member creates from the API (`sample_project.py`) still draws its regions. It is not part of the showcase seed and is left for a later task.

## Conclusion

Every AI result the showcase seed creates now comes from InstanSeg with the HoVer-NeXt typer and the MONAI tumour model, run on 2,048 px crops of 13 of the 15 gallery slides. A slide took 26 to 220 s on a shared CPU and peaked under 7.5 GB, and the runs cost nothing. A seed test fails if any seeded result's outlines or counts do not come from these files. The deployed demo shows them after the lead's next reset.
