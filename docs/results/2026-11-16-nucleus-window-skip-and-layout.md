# Result: skipping nucleus windows without tissue keeps every cell in tissue and leaves 11,448 windows on test_001, still over an hour of L4 time, and three windows per tile fail the reference

- Date: 2026-11-16
- Backlog: AINUC-011 (throughput target)
- Kind: check
- Commit: the AINUC-011 commit that adds this file and `workers/ml/spike/nuclei_layout_check.py`
- Environment: Apple M4 Mac, onnxruntime 1.31.1 on `CPUExecutionProvider`, local graphs `pathosam.encoder.onnx` and `pathosam.ais_decoder_full.onnx`. No cloud run and no cost
- Data: `CMU-1-Small-Region.svs` with the AINUC-001 (detector runner) reference `workers/ml/tests/fixtures/pathosam-ais-cmu-1-small-region.json`, and CAMELYON16 `test_001.tif` (CC0) from the local fixture cache. No PHI

## Question

The L4 run of the same day ([2026-11-16-nucleus-job-throughput-on-l4.md](2026-11-16-nucleus-job-throughput-on-l4.md)) projected 2.56 hours for test_001, with 18,372 encoder passes at 0.356 s each. Which ways of running fewer windows keep the AINUC-001 reference, and how many windows does test_001 then need?

## Method

`uv run --package parfocal-ml --extra tumor python workers/ml/spike/nuclei_layout_check.py`, plus a count over the whole test_001 tile plan with the same code (thumbnail and tissue mask only, no model).

1. **Tissue skip.** `stitched_maps` takes a window filter, and `PathoSamDetector` builds one from the slide's tissue mask (`tissue_filter`). A window runs when its halo reaches a 64 px tissue cell, so a skipped window's core lies at least 64 model px from any tissue. Two test_001 tiles with 8 and 10 tissue windows ran with and without the skip, and the cells whose centre lies in a tissue cell were compared ring by ring.
2. **Three by three windows.** A balanced layout cuts a 1,656 px tile into 573, 510 and 573 px cores, so every window stays at most 640 px and the encoder scale stays near 1.6. It was run on the reference region, on the 1,653 px CMU tile and on a dense test_001 tile, against the current 512 px grid.
3. **Smaller tiles.** The count was repeated with a 1,414 model px tile core and the same 60 px context, so the tile and halo come to at most 1,534 px and fit three grid windows.
4. Half precision was not tried, because no projection needing it was under an hour.

## Results

| Run on the reference | Nuclei | Count change | Matched within 1 slide px | Median area ratio | Windows |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512 px grid (current) | 366 of 366 | 0.0% | 97.5% | 0.976 | 4 |
| Balanced three by three | 358 of 366 | −2.2% | 65.0% | 0.974 | 4 |
| Limit in the weights test | | within ±1% | at least 95% | 0.95 to 1.05 | |

| Balanced against grid | Nuclei | Count change | Matched | Median area ratio | Windows |
| --- | ---: | ---: | ---: | ---: | ---: |
| CMU tile, 1,653 px | 315 against 316 | −0.3% | 69.0% | 1.012 | 9 against 16 |
| test_001 tile 128, dense | 679 against 670 | +1.3% | 37.5% | 0.984 | 9 against 16 |

| Tissue skip on test_001 | Windows run | Cells in tissue | Same rings |
| --- | ---: | ---: | --- |
| Tile 77 | 8 of 16 | 78 and 78 | yes |
| Tile 1414 | 10 of 16 | 51 and 51 | yes |

| test_001 plan | Tiles | Windows | Kept by the skip | GPU arithmetic at 0.356 s |
| --- | ---: | ---: | ---: | ---: |
| Today, 1,536 px core, grid | 1,149 | 18,372 | 11,448 | 4,075 s |
| Balanced three by three (fails the reference) | 1,149 | 10,335 | 7,020 | 2,499 s |
| 1,414 px core, grid, at most 9 a tile | 1,285 | 11,559 | 8,068 | 2,872 s |

## Interpretation

- The tissue skip changes nothing inside tissue on the two edge tiles and removes 38% of the windows. It is built behind an optional `tissue` mask on `PathoSamDetector` and stays off unless a caller passes the mask.
- With the skip alone, the GPU passes take about 4,075 s, so test_001 cannot finish in an hour on one L4 even if all CPU work runs alongside. No GPU run was made.
- The balanced layout moves the reference's window seam by 1 px, from 512 to 511, and the reference then fails on count and on matching. The reference holds only at today's window positions, so any other way of cutting windows inside a tile is expected to fail the same gate. The 2 px matching cannot by itself tell such a change from a harmful one: the rejected 1,024 px windows scored 64.6% on the CMU tile and the balanced layout 69.0%, and only their area ratios (1.115 against 1.012) differ clearly. The layout lives only in the check script.
- A 1,414 px tile core keeps the detector and the reference untouched and needs 8,068 windows, about 2,872 s of GPU. The CPU post-processing was measured at 2.04 s on 1,656 px tiles, so the CPU side is not known for the smaller tiles. Scaled by area it would be about 2,500 s for 1,285 tiles, which is arithmetic, not a measurement. Run one after the other the slide would take about 5,400 s, and with the CPU work overlapped about 2,900 s. ADR 0240 (one working chunk per tile) pins the 1,536 px core, so this is a question for the owner.
- `run_tiles` can now look one tile ahead (`ahead=1`), which lets the CPU post-processing of one tile run while the next tile's windows use the GPU. A lock keeps one GPU pass at a time. The chunks and their order are the same as in the serial run (unit tests). The overlap is not measured on a GPU.

## Follow-ups

- Decision 135 (how the nucleus job gets under one hour on an L4) asks whether the nucleus tile may shrink to a 1,414 px core or the reference may tolerate window position. After the answer, one L4 run on Modal `dev` with the skip, `ahead=1` and an explicit CPU request measures the real time. `TODO`
- The pool sets no CPU for `detector_best`, so overlap may gain little on Modal's default share. The next run requests 4 cores. `TODO`
