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
| T4 in the embedder pool | TODO, not measured, nothing was deployed |

## Reading

On CPU one view tile takes about 5.5 s, well above the 1 s target, so the pool must run on its GPU for the panel to feel live. The T4 time needs one deploy of the pool app with the AITUM-011 (the tumor map pool ready to deploy) image and storage secrets, then one timed `view-map` call. ADR 0357 expects about 1.4 s from 4 job tiles at the 0.34 s a tile measured on a laptop GPU, which is an estimate and not a T4 number.
