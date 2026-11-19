# Result: PathoSAM ViT-L with its own decoder outlines a clicked TNBC nucleus 0.032 IoU better than the browser's ViT-B, and the ViT-B decoder cannot read a ViT-L embedding at all

- Date: 2026-11-19
- Backlog: AISEG-024 (Best one-click outlines run PathoSAM ViT-L on the server)
- Kind: ML evaluation
- Commit: eddc0a9f plus the AISEG-024 change on its branch
- Environment: MacBook with Apple M4 and 24 GB, macOS 15.8.1, Python 3.14, onnxruntime 1.31.1 on `CPUExecutionProvider`. Other agents shared the machine and its load average was about 18, so times are not reported
- Data: the first 22 of the 50 TNBC images (512 by 512 pixels, Zenodo 1175282, public, no PHI) in the order `parfocal_ml.datasets` gives them, 1,164 prompted nuclei. TNBC is outside PathoSAM's training pool (POC doc 26, held-out benchmarks)

## Question

Decision 156 (what the Best model does for one-click outlines) gives Best the ViT-L encoder on the server. Does a ViT-L outline beat the outline Good draws in the browser, on the labelled nucleus set the repository already scores with the interactive protocol of MLEVAL-003 (interactive protocol)? And can the browser's existing ViT-B decoder read the ViT-L embedding, or does Best need the ViT-L decoder too? No bar was fixed before the run. The baseline is the same harness on the same nuclei with `pathosam.encoder_uint8.onnx`, the graph Good runs on WebAssembly.

## Method

```
pnpm --filter @parfocal/ml export:sam -- --vit-l
uv run --package parfocal-ml --extra onnx python -m parfocal_ml.interactive --threads 4 --encoder pathosam-vit-l.encoder.onnx --decoder pathosam-vit-l.decoder.onnx
uv run --package parfocal-ml --extra onnx python -m parfocal_ml.interactive --threads 3 --encoder pathosam.encoder_uint8.onnx
uv run --package parfocal-ml --extra onnx python -m parfocal_ml.interactive --threads 2 --images 6 --encoder pathosam-vit-l.encoder.onnx --decoder pathosam.decoder.onnx
```

The export loads `vit_l_histopathology.pt` (SHA-256 9e65d8f4, 1,249,494,242 bytes) into `segment_anything`'s `vit_l` and traces the fp32 encoder, the click decoder and the 32 token window decoder at opset 17, as AISEG-001 (ONNX export pipeline) did for ViT-B. The harness is `parfocal_ml.interactive` unchanged except for a new `--decoder` option. Prompts, scoring and the refinement path are those of the 2026-11-06 interactive protocol result.

All three runs were stopped before the 50 images were done, because the shared Mac ran out of memory during the session. The ViT-L run had reached 1,738 nuclei, the ViT-B run 1,164 and the mixed decoder run 55. The table compares the 1,164 nuclei both full runs scored, nucleus by nucleus. `TODO`: finish all 50 images, on Modal and not on the Mac.

## Results

Files and memory of the export.

| Graph | Bytes | Note |
|---|---|---|
| `pathosam-vit-l.encoder.onnx` | 1,234,257,496 | fp32, SHA-256 b3552341, runs on the server |
| `pathosam-vit-l.decoder.onnx` | 16,495,861 | browser |
| `pathosam-vit-l.decoder_window32.onnx` | 16,496,126 | browser |

The export peaked at 5.37 GB resident (`/usr/bin/time -l`) and took 40 s. The peak of the ViT-L scoring run was not captured because the run was stopped. It held 1.47 GB when sampled once with `ps`.

Mean IoU per nucleus on the 1,164 shared nuclei of 22 TNBC images. The standard error is of the paired difference.

| Prompt | Nuclei | ViT-L, own decoder (Best) | ViT-B uint8 (Good) | Difference | Standard error | ViT-L better by over 0.02 | ViT-L worse by over 0.02 |
|---|---|---|---|---|---|---|---|
| Ideal click | 1,164 | 0.8982 | 0.8660 | +0.0321 | 0.0016 | 61.8% | 5.1% |
| Realistic click | 1,164 | 0.8973 | 0.8657 | +0.0316 | 0.0017 | 61.9% | 5.2% |
| Exact box | 1,164 | 0.9001 | 0.8702 | +0.0298 | 0.0011 | 66.3% | 5.7% |
| Loose box | 1,164 | 0.8671 | 0.8232 | +0.0439 | 0.0015 | 74.3% | 5.8% |
| Two clicks | 284 | 0.9084 | 0.8846 | +0.0237 | 0.0024 | 52.5% | 7.7% |
| Three clicks | 283 | 0.9133 | 0.8907 | +0.0226 | 0.0020 | 50.2% | 7.1% |

Share of realistic clicks at IoU 0.75 or better: 93.5% for ViT-L and 92.4% for ViT-B. For a loose box it is 90.7% against 82.3%.

The ViT-L embedding decoded with the ViT-B decoder, on the 55 nuclei of the first image:

| Prompt | ViT-L, own decoder | ViT-L embedding, ViT-B decoder |
|---|---|---|
| Ideal click | 0.9315 | 0.0009 |
| Realistic click | 0.9316 | 0.0008 |
| Exact box | 0.9232 | 0.0024 |
| Loose box | 0.8824 | 0.0015 |

Deployment on 2026-11-19. The encoder is in model artifacts as `models/pathosam-vit-l/v1/encoder.onnx` in R2 `parfocal-dev-eu`, the two decoders are in `parfocal-dev-eu/models/`, and `parfocal-gpu-pool` is deployed to Modal `main` with the `view-embedding` runner in the embedder pool. A first call to that pool waited over six minutes with the Modal message "waiting to be scheduled on a GPU_T4 worker" in region `eu` and was cancelled before any container started. So the cold start, the warm seconds per view and the peak GPU memory on a T4 are not measured. `TODO`: measure them when a T4 is free, with `apps/web/smoke/best-outline.spec.ts`.

Cost. The publish ran one CPU container for under two minutes. No GPU second was billed, because no GPU container started. Storage adds 1.27 GB to R2, about 0.02 dollars a month. `TODO`: the exact Modal figure from the usage page.

## Interpretation

- On these 22 images ViT-L with its own decoder is better than the browser's ViT-B for every prompt, by 0.023 to 0.044 mean IoU, 13 to 29 standard errors. It improves about six nuclei in ten and worsens one in twenty. The gain is largest for a loose box, which is the prompt a person draws by hand.
- The share of clicks that are already good moves little (93.5% against 92.4%), so most of the gain is tighter outlines on nuclei both models find.
- The ViT-B means here (0.866 for a click) are above the 0.852 the same harness gave on all 50 images on 2026-11-06, so these 22 images are easier than the rest. The difference between the models is paired and does not depend on that, but its size on the other 28 images is not known.
- The decoders are not interchangeable. Best must use the ViT-L decoder with the ViT-L embedding, which [ADR 0404](../adr/0404-best-one-click-outlines-use-a-live-vit-l-embedding-and-the-vit-l-decoder.md) (Best uses a live ViT-L embedding and the ViT-L decoder) records.
- Good on WebGPU runs the 4-bit ViT-B encoder, which was not scored here. The 2026-11-06 export result puts it 0.005 mean IoU under the uint8 encoder against PyTorch.

## Follow-ups

- `TODO` finish the 50 images and add CryoNuSeg and NuInsSeg, on Modal.
- `TODO` cold and warm seconds and peak GPU memory of the ViT-L encode on a T4, which ADR 0202 (the v1 model line-up per tier) asks of every v1 row.
- The embedder pool could not get a T4 in `eu` today. OPS-036 (view maps and tumor maps open a seeded slide) already asks what a GPU job does when the EU has no GPU free, and Best depends on the same answer.
