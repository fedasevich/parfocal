# XXXX. PathoSAM exports to ONNX with the legacy TorchScript exporter, a square traced orig_im_size and a gate against PyTorch

- Date: 2026-11-06
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-001 (ONNX export pipeline). Builds on [ADR 0148](0148-browser-ml-runtime-onnxruntime-web.md) (browser models run on onnxruntime-web 1.31.1)

## Context

The viewer runs PathoSAM in the browser, so every AISEG task after this one loads graphs exported from the PyTorch checkpoints. POC doc 12 (the Python side and a pathology model in the browser) found that the SAM decoder exporter freezes `int(prepadded_size)` into a constant when it traces, so a decoder traced with a non-square `orig_im_size` returns masks displaced in y by a factor of 1.4993. The graphs must also keep the samexporter input names the POC client fills. torch 2.15 defaults `torch.onnx.export` to the dynamo exporter and still offers the legacy TorchScript one behind `dynamo=False`.

## Options considered

1. The legacy TorchScript exporter (`dynamo=False`) at opset 17, with the official `segment_anything` decoder wrapper traced on a square `orig_im_size`. It is what the POC shipped and measured in the browser, and the result file shows the fp32 graphs agree with PyTorch.
2. The dynamo exporter. It may trace the crop symbolically and lift the square limit, but it emits a different graph (opset 18 and up, other operator choices) that onnxruntime-web's WebGPU kernels were never measured on. Not measured.
3. A hand-written decoder wrapper without the crop. Equivalent to option 1 for square patches and more code to own. Not measured.

## Decision

Option 1. `python -m parfocal_ml.sam_onnx.export` writes six graphs into `~/.cache/parfocal/models/onnx` (or `$PARFOCAL_MODELS_DIR/onnx`): the encoder, the samexporter decoder, the batch decoder, the AIS decoder with its sigmoid and 512 pooling inside the graph, the uint8 dynamic per-channel encoder and the 4-bit `MatMulNBits` encoder.

- Patches sent to the decoder are square. `decoder_feeds` refuses a non-square `orig_im_size`.
- Checkpoints are found by SHA-256 in the models cache and linked from `PARFOCAL_MODELS_LOCAL` folders, the way slide fixtures are. Nothing is committed.
- `python -m parfocal_ml.sam_onnx.verify` is the gate: fp32 masks may differ from PyTorch only at pixels whose logit is within 1e-3 of the threshold, the batch decoder must match with IoU 1.0, the AIS maps within 1e-3, and quantised encoders must reach a mean IoU of at least 0.96 on TNBC patches. The [result](../results/2026-11-06-pathosam-onnx-export.md) has the numbers. The `weights` pytest marker runs it, and default runs skip it.
- torch, onnx, onnx-ir, onnxruntime and segment-anything sit in the `export` extra of `parfocal-ml`, so CI and the Modal images do not install them. The torch-dependent package is excluded from basedpyright for the same reason.

## Consequences

- A torch or onnxruntime bump reruns the gate before new graphs are published.
- A non-square patch needs a new export, not a client change.
- If torch removes the legacy exporter, option 2 or 3 has to pass the same gate and the browser timings in AISEG-002 (quantised variants per execution provider) have to be rerun.
- The checkpoints have no public download wired in yet, so a fresh machine needs them placed by hand. TODO: pin the PathoSAM release URL.
