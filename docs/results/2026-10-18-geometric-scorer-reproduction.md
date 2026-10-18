# Result: the geometric scorer reproduces the POC's TNBC numbers

- Date: 2026-10-18
- Backlog: MLEVAL-002 (geometric scorer)
- Kind: ML evaluation
- Commit: 8915e44 plus the uncommitted `parfocal_ml.scoring` of MLEVAL-002
- Environment: MacBook (Apple silicon, arm64), macOS 15.8.1, Python 3.14 through uv, numpy, scipy and scikit-image 0.26.0. No GPU
- Data: the POC's TNBC fixtures (`poc/server/fixtures/tnbc`, 50 images, 4,056 nuclei after vague ones are dropped) and the stored predictions of 11 methods in `fixtures/tnbc/results/*.jsonl`. Nothing from them is committed here

## Question

Does `parfocal_ml.scoring` give the same numbers as the POC's geometric scorer (`poc/server/tools/score_region.py`, POC doc 26) on the same predictions? The POC's stored numbers are in `fixtures/tnbc/results/region.all.json`.

## Method

For each method in `region.all.json` with a predictions file, score every image with `score_image(labels, rings, ignore)` and pool them with `summarise`. Score the same predictions with the POC's `score_region.score` in quick mode, imported from the POC tree without writing anything. Compare nuclei, predictions, recall, precision, F1, PQ and SQ. The script is the throwaway `compare.py` run with `uv run --package parfocal-ml python compare.py`. `workers/ml/tests/test_scoring.py` repeats the check against the stored numbers for three methods whenever the POC fixtures are on the machine.

## Results

| Method | Nuclei | Predicted | PQ stored | PQ POC scorer | PQ ours | F1 ours | Recall ours | AJI ours | Same as POC scorer |
|---|---|---|---|---|---|---|---|---|---|
| hovernet-batch | 4056 | 2735 | 0.5124 | 0.5124 | 0.5124 | 0.6821 | 0.5710 | 0.4611 | yes |
| unet-nuclei-batch | 4056 | 3469 | 0.4197 | 0.4197 | 0.4197 | 0.5916 | 0.5488 | 0.4386 | yes |
| classical-batch | 4056 | 34749 | 0.0111 | 0.0090 | 0.0090 | 0.0146 | 0.0700 | 0.0857 | yes |
| pathosam-ais-batch | 4056 | 4044 | 0.8282 | 0.8282 | 0.8282 | 0.9521 | 0.9507 | 0.8427 | yes |
| pathosam-ais-browser | 4056 | 4052 | 0.8235 | 0.8235 | 0.8235 | 0.9489 | 0.9485 | 0.8393 | yes |
| pathosam-auto-hv-both | 4056 | 4031 | 0.7692 | 0.7692 | 0.7692 | 0.9291 | 0.9263 | 0.7839 | yes |
| pathosam-auto-fast | 4056 | 3961 | 0.7629 | 0.7629 | 0.7629 | 0.9218 | 0.9110 | 0.7767 | yes |
| pathosam-auto-hv | 4056 | 2591 | 0.6706 | 0.6441 | 0.6441 | 0.7658 | 0.6275 | 0.5687 | yes |
| hovernet-m0.4-targmax-k0.4-s0 | 4056 | 2735 | 0.5124 | 0.5124 | 0.5124 | 0.6821 | 0.5710 | 0.4611 | yes |
| hovernet-m0.4-targmax-k0.4-s1 | 4056 | 2735 | 0.5371 | 0.5371 | 0.5371 | 0.6995 | 0.5856 | 0.4804 | yes |
| vista2d-batch | 4056 | 2129 | 0.4555 | 0.4555 | 0.4555 | 0.6024 | 0.4593 | 0.3356 | yes |

"Same as POC scorer" means nuclei and predictions are equal and recall, precision, F1, PQ and SQ agree to 1e-12.

## Interpretation

- The scorer matches the POC's scorer exactly on every method, so the 4x supersampled centre sampling, the vague-nucleus rule, the ignore mask and the PQ and F1 definitions carry over unchanged.
- Two stored POC numbers are stale: `classical-batch` (PQ 0.0111 stored, 0.0090 today) and `pathosam-auto-hv` (0.6706 stored, 0.6441 today). The POC's own scorer gives today's values on the current prediction files, so the files were rewritten after `region.all.json` was saved. The test leaves those two out of the stored-number check.
- AJI is new here and has no POC number to compare with. It is the mean over images of Kumar's aggregated Jaccard index, computed on the same supersampled grid. Its unit tests check hand-worked cases.
- Per-organ breakdowns use an image's group, such as NuInsSeg's `organ`. TODO: record per-organ numbers on NuInsSeg when MLEVAL-001 (dataset registry and loaders) loads it.

## Follow-ups

- MLEVAL-001 loads the datasets through a registry instead of the POC paths the test reads.
- TODO: the reproduction test is skipped in CI, because the fixtures are not committed. It runs on any machine with the POC fixtures at `PARFOCAL_POC_FIXTURES`.
