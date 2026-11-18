# Result: one view tile through the embedder pool's view map runner

- Date: 2026-11-16
- Backlog: AITUM-012 (the interactive pool answers view map calls)
- Kind: latency measurement
- Commit: the AITUM-012 commit on top of `db0b9201` (`workers/ml/src/parfocal_ml/view_map_worker.py`, `workers/ml/spike/time_view_tile.py`)
- Environment: Apple M4, macOS, CPU only, onnxruntime `CPUExecutionProvider`, worktree venv with the `tumor` extra. Two other agents were running on the same Mac, so the CPU time is an upper bound
- Data: a synthetic 4,096 by 4,096 px slide that is tissue everywhere, so all 4 job tiles of view tile 0,0 are scored. Weights: `camelyon-tumor.onnx` from AITUM-010 (the tumor model as ONNX)

## Question

How long does one `view-map` call take in the embedder pool, against the 1 s interactive target of ADR 0357 (the view map asks the interactive lane for one view tile at a time)?

## Method

```
cd workers/ml
uv run --package parfocal-ml --extra tumor --all-groups python spike/time_view_tile.py --runs 3
```

The script builds a `ViewMapService` with the ResNet18 scorer loaded once, answers view tile 0,0 three times and times each `answer` call. The slide is in memory, so the times hold scoring and halving only, no slide download.

## Results

| Measure | Value |
|---|---|
| Cells in the reply | 256 |
| CPU, three runs | 6.415 s, 5.465 s, 5.362 s |
| CPU, median | 5.465 s |
| T4, first call (CUDA warm-up) | 1.314 s |
| T4, seven warm calls | 0.768, 0.743, 0.741, 0.744, 0.738, 0.740, 0.749 s |
| T4, warm median | 0.743 s |
| T4, scorer load | 1.809 s, CUDAExecutionProvider active |

## T4 measurement

2026-11-18, Modal environment `main`, one throwaway ephemeral app (`parfocal-spike-view-tile-t4`, `workers/ml/spike/time_view_tile_t4.py`) on a T4 with the pool image of `modal_pool.pool_image()` (CUDA 13.3.1, onnxruntime-gpu 1.31.1) and the same `ViewMapService` and `OnnxTumorScorer` code as the pool entry's `view-map` runner. The same synthetic slide was held in memory, so the times hold scoring and halving only, no slide download and no queue or cold container start. The deployed pool app was not touched. The app stopped when the run ended and no container of it was left. The cost is TODO, not read from the Modal usage page, and at about 25 s of T4 time it is well under $0.01.

## Reading

On CPU one view tile takes about 5.5 s. On the T4 it takes 0.743 s warm, which meets the 1 s target of ADR 0357, and 1.3 s on the first call after the scorer loads. ADR 0357 estimated about 1.4 s, so the T4 is faster than that estimate. The number is the work inside the pool only. A real call adds slide reads from storage, the lane hop and a possible cold start, which a deployed pool run would still have to time end to end.
