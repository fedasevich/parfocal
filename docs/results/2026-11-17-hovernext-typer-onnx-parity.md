# Result: the HoVer-NeXt typer exports to ONNX within 5e-6 of torch at any size and is published for the viewer

- Date: 2026-11-17
- Backlog: OPS-026 (export and publish the HoVer-NeXt typer for the viewer)
- Kind: ML export and production artifact check
- Commit: the OPS-026 commit (`workers/ml/src/parfocal_ml/hovernext_export.py`, `workers/ml/spike/publish_typer_onnx.py`)
- Environment: Apple M4, 24 GB, macOS 15, Python 3.14 through uv, torch 2.15 and timm 1.0.31 on CPU, onnxruntime 1.31.1 on the CPU provider. Other agents shared the machine
- Data: HoVer-NeXt PanNuke fold 2 weights, `pannuke_convnextv2_tiny_2.zip` from Zenodo record 10635618 (md5 `16a91941594de18e623c80b8dfc128e2` as Zenodo states it, checkpoint SHA-256 `10d0580bb0616b081d19da90f87196a4db8554963720bf2fe11822d4b215557e`, CC BY-NC-SA 4.0). PanNuke fold 3 from the dataset cache. Public data, no PHI, nothing committed

## Question

ADR 0377 (the viewer typer runs in the interactive pool) fixed the contract of `typer.onnx`: one `pixels` input of uint8 RGB in NHWC at 0.25 µm per pixel, any height and width, and six class probabilities in NCHW out, background first. Does an export to that contract match the torch network, does it still type nuclei correctly, and does the published object match the export?

## Method

```
uv run --package parfocal-ml python -m parfocal_ml.hovernext_export
uv run --package parfocal-ml pytest workers/ml/tests/test_hovernext_export.py -m weights
uv run --package parfocal-ml python workers/ml/spike/publish_typer_onnx.py \
  ~/.cache/parfocal/models/onnx/hovernext-pannuke.typer.onnx --target minio --bucket parfocal-local
uv run --package parfocal-ml python workers/ml/spike/publish_typer_onnx.py \
  ~/.cache/parfocal/models/onnx/hovernext-pannuke.typer.onnx --target r2 --bucket parfocal-dev
```

`hovernext_export` builds the network fresh on timm's ConvNeXt-V2 tiny, loads the checkpoint with `weights_only=True` and `strict=True`, and exports only the class branch: encoder, class decoder and class head. The graph casts and divides by 255, pads reflectively to a multiple of 32, runs the network, crops back and applies softmax, as the POC typer did with one view. It is traced at 250 by 270 with dynamic height and width, opset 17. Parity runs the torch module and the ONNX file through the runner's own `OnnxTyper` on PanNuke tissue tiled to each size. The typing check averages the ONNX class map inside each true PanNuke outline of every fifth fold 3 image, the first 60 of them. The publish script refuses any file but this export, writes each object with `If-None-Match: *`, fetches it back through `ModelArtifacts.fetch` and opens it with `OnnxTyper`. Before the R2 write both keys were checked absent. A local run of `answer_outline_types` with the export and temperature 1.42 typed 12 true outlines of one fold 3 image.

## Results

| Size (height by width) | Max absolute difference | Same class at every pixel |
|---|---|---|
| 256 by 256 | 3.34e-6 | 100% |
| 300 by 417 | 3.96e-6 | 100% |
| 1,060 by 1,060 | 4.92e-6 | 100% |

| Measure | Value |
|---|---|
| Typing on PanNuke fold 3, 60 images, 1,275 nuclei | 84.9% right in PanNuke classes, 84.9% in viewer classes |
| Runner on 12 true outlines | 12 typed, 12 match the truth |
| Export | 128,040,280 bytes, SHA-256 `fdf65836a8971a989fd34b76ba5698bfa1b6bc91ca921b5a6accaaff91e9593d` |
| Published in R2 `parfocal-dev` | `models/hovernext-pannuke/v1.2/typer.onnx` (128,040,280 bytes) and `models/hovernext-pannuke/v1.2/manifest.json` (259 bytes), fetched back with the same SHA-256 |
| Published in MinIO `parfocal-local` | the same two keys and SHA-256 |
| Cost | 128 MB stored, about $0.002 a month, and two writes inside the free tier |

## Interpretation

- The export matches torch a thousand times tighter than the 1e-3 the InstanSeg export test allows, and also at sizes that are not multiples of 32, so the padding is dynamic in the graph and not baked in. The test asserts 1e-4.
- 84.9% on fold 3 is close to the 83.0% the POC's cached outputs give on the same fold with one view (the [typing reproduction](2026-10-18-typing-calibration-reproduction.md)), so the normalisation and class order inside the graph are right. The sample is smaller and differs, so the two numbers are not a replay of each other.
- The deployed runner fetches `typer.onnx` from these keys on its first call, so the route can answer once a release carries the runner of OPS-025 (the viewer typing tool on a GPU typer runner). A failed setup is retried on the next call, so no restart is needed.

## Limits

- Fetched and run from a Mac on the CPU provider. The CUDA provider in the embedder pool is not tested.
- The deployed route has not typed an outline on a seeded slide yet. The release of 2026-11-17 at 23:31 UTC (commit `fb427c23`) carries the route and the `parfocal-gpu-pool` embedder with the runner, but no agent can sign in to `app.parfocal.eu`. Decision 147 (how an agent checks the viewer typing tool on the deployed app) asks the owner.
- An input smaller than 32 px on a side cannot be padded reflectively. The runner never sends one, because it widens every window to at least 256 px unless the slide itself is smaller.
