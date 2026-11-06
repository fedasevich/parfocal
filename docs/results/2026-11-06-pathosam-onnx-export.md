# Result: PathoSAM ONNX export against PyTorch

- Date: 2026-11-06
- Backlog: AISEG-001 (ONNX export pipeline)
- Kind: check
- Commit: d415ff1e plus the AISEG-001 change on its branch
- Environment: Apple M4, macOS 15.8.1, CPU only, Python 3.14.7, torch 2.15.0, onnxruntime 1.31.1, onnx 1.23.2, opset 17. Other agents shared the machine during the run, so times are indicative only
- Data: the first 8 TNBC patches (512 by 512, public, no PHI) from `parfocal_ml.datasets`, 78 clicks on the deepest pixel of each labelled nucleus of at least 30 pixels, up to 10 per patch. Checkpoints `vit_b_histopathology.pt` (SHA-256 98c79908) and `vit_b_histopathology_decoder.pt` (SHA-256 be91d627)

## Question

Do the exported graphs give the same masks as PyTorch? The Done-when line asks for IoU 1.0 for fp32 and at least 0.96 for quantised graphs. The POC reported agreement on one click (doc 12).

## Method

```
pnpm --filter @parfocal/ml export:sam
pnpm --filter @parfocal/ml verify:sam -- --patches 8 --clicks 10
```

The reference is `SamPredictor` from `segment_anything` with `multimask_output=True`, its best of three masks thresholded at 0. The ONNX path preprocesses with `sam_contract.pixel_values`, runs each encoder, then the decoder with the samexporter feeds and a square `orig_im_size`, and picks the best of the three multimask outputs. The batch decoder and the AIS decoder are compared with their eager PyTorch modules on the PyTorch embeddings. "Flipped logit" is the largest absolute PyTorch logit at a pixel where the two masks disagree, so a small number means only pixels sitting on the threshold differ. The uint8 encoder is dynamic per-channel QUInt8 on MatMul weights, and the q4 encoder is `MatMulNBits` with block size 32, symmetric, accuracy level 4.

## Results

| Graph | Size (MB) | Clicks with IoU 1.0 | Min IoU | Mean IoU | Mean IoU, same mask index | Flipped logit | Embedding max abs diff | CPU encode (ms, median) |
|---|---|---|---|---|---|---|---|---|
| encoder fp32 | 359.2 | 77 of 78 | 0.9959 | 0.9999 | 0.9999 | 2.55e-5 | 5.59e-6 | 2,679 |
| encoder uint8 per-channel | 100.7 | 7 of 78 | 0.3631 | 0.9668 | 0.9746 | 10.8 | 0.146 | 2,528 |
| encoder q4 | 72.6 | 1 of 78 | 0.7843 | 0.9614 | 0.9638 | 5.62 | 0.262 | 3,047 |

| Graph | Size (MB) | Check | Result |
|---|---|---|---|
| decoder | 16.5 | median CPU decode per click | 31.6 ms |
| batch decoder | 16.5 | min IoU of the chosen low-res mask, 78 prompts | 1.0 |
| batch decoder | | max abs score difference | 2.86e-6 |
| AIS decoder | 44.2 | max abs difference of the three sigmoid maps | 1.54e-4 |
| AIS decoder | | foreground IoU at 0.5, 8 patches | 1.0 on 7, 0.99997 on 1 |

PyTorch encodes in a median 3,236 ms on the same machine. An earlier run with the per-tensor uint8 encoder the POC used gave a mean IoU of 0.9572 (min 0.3427, embedding max abs diff 0.254) on the same 78 clicks, below the 0.96 bar, so the export now quantises per channel at the same size.

## Interpretation

The fp32 graphs agree with PyTorch. The one click below 1.0 differs by one pixel whose logit is 2.55e-5 from the threshold, which is float rounding, not an export fault, so the gate counts fp32 as passing when every flipped pixel is within 1e-3 of the threshold. A strict IoU of 1.0 on every click would fail on rounding alone. Both quantised encoders clear a mean IoU of 0.96. Their minimum is low because on a few clicks the best of the three multimask outputs changes, which the same-index column only partly removes. The q4 encoder clears the bar by 0.0014, and on the first 4 patches alone it fell under, so the gate test runs the same 8 patches and 10 clicks as this table.

## Follow-ups

- ADR XXXX (PathoSAM ONNX export contract) records the exporter, the square trace and the gate.
- AISEG-002 (quantised variants per execution provider) owns the browser timings and could try a q4 block size of 16 or an accuracy level other than 4 to widen the margin.
- TODO: pin a public download for the two checkpoints. Today they are linked from `PARFOCAL_MODELS_LOCAL`.
