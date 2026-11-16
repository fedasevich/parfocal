# Result: the tumor ResNet18 exported to ONNX scores a tile as torch does

- Date: 2026-11-16
- Backlog: AITUM-010 (the tumor map job reads stored slides and runs the tumor model in its pool)
- Kind: ML parity check
- Commit: the AITUM-010 commit on top of `5124bd7e` (`workers/ml/spike/export_tumor_onnx.py`, `workers/ml/src/parfocal_ml/tumor_map_worker.py`, `workers/ml/tests/test_stored_slides.py`)
- Environment: Apple M4, macOS 15.8.1, CPU only. Export in the POC's server venv (torch 2.14.0, MONAI 1.6.0, onnx 1.22.0, onnxruntime of that venv). Check in the worktree venv with onnxruntime 1.31.1 and openslide-python 1.4.6, local MinIO
- Data: `CMU-1-Small-Region.svs` from the `small` fixture group. Weights: MONAI `pathology_tumor_detection` 0.6.4 `models/model.pt`, SHA-256 `5a0d9b9e714e18a90c1f7f7d9c7e47f807c59f9f8c681b84865fae208fcbb4d6`

## Question

Does the ResNet18 run as ONNX give the same tile scores as torch, so the pool can use onnxruntime without changing the map ADR 0351 (the v1 tumor model) measured?

## Method

```
<POC>/server/.venv/bin/python workers/ml/spike/export_tumor_onnx.py \
  <POC>/server/apps/pathology/model/pathology_tumor_detection/models/model.pt \
  ~/.cache/parfocal/fixtures/CMU-1-Small-Region.svs ~/.cache/parfocal/models/onnx/camelyon-tumor.onnx
pnpm --filter @parfocal/ml test:tumor
```

1. `TorchVisionFCModel("resnet18", use_conv=True)` with the bundle weights, exported with the TorchScript exporter at opset 17 and a fixed input of 1 by 3 by 2,240 by 2,240.
2. One tile, level 0 at the origin, alpha 0 set to white, scaled to -1..1, sigmoid of the logits, scored by torch and by onnxruntime in the export venv.
3. The weights test uploads the slide to MinIO, opens it through `StoredSlides`, scores the same tile with `OnnxTumorScorer` and compares it with the saved torch scores, then maps the whole slide.

## Results

| Measure | Value |
|---|---|
| ONNX file | 44,701,121 bytes, SHA-256 `9f5e526f6b4f6dd3c9a58df9d40a4ce600a4a97e854ee9b77165a18d6e2400f1` |
| Output | 64 by 64 per tile, as `pooled` expects |
| Largest difference from torch, export venv | 1.9e-7 |
| Through the stored opener, onnxruntime 1.31.1 | within the test's 1e-5 |
| Whole slide through MinIO | 2 tissue tiles, grid 35 by 47 cells, zero off tissue |

## Limits

- One tile of one slide that is not lymph node tissue, so it checks the runtime, not accuracy. Accuracy stays the MLEVAL-005 (tumor map evaluation) result on CAMELYON16 test slides.
- CPU only. The T4 speed and memory in ADR 0355 (the tumor map shares the detector-good pool) stay `TODO`.
