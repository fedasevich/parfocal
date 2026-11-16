# Result: Generic MobileSAM on the TNBC interactive protocol

- Date: 2026-11-16
- Backlog: AISEG-000 (interactive segmentation research check)
- Kind: ML evaluation
- Commit: 74ebacd0, with two scratch scripts given in full under Method and not committed (the bench script printed one more key, the folder path, left out here)
- Environment: MacBook with Apple M4 and 24 GB, macOS 15.8.1, Python 3.14.10, numpy 2.5.4, onnxruntime 1.31.1 on `CPUExecutionProvider`, one Python process. Other agents shared the machine, so times are indicative only
- Data: all 50 TNBC images (Zenodo 1175282, public, no PHI) from `parfocal_ml.datasets`, 3,466 prompted nuclei. Weights `vit_t_mobile_sam.pth` from the micro-sam registry's `vit_t` link on owncloud.gwdg.de, 40,728,226 bytes, SHA-256 6dbb9052

## Question

How far is a small SAM that was never fine-tuned on pathology from PathoSAM ViT-B on the same prompts? No small SAM fine-tuned on pathology was found (the micro-sam registry has histopathology checkpoints for ViT-B, ViT-L and ViT-H only, and one web search found none), so generic MobileSAM is the lower bound for a Fast tier small SAM. EdgeSAM and EfficientViT-SAM were not run. They are generic too, and a fine-tune of any of them is a GPU training run.

## Method

MobileSAM is TinyViT with SAM's prompt encoder and mask decoder, so it fits the existing export and harness unchanged. The scratch export script loaded the checkpoint with `torch.load(..., weights_only=True)` into `mobile_sam.sam_model_registry["vit_t"]()` (package from `github.com/ChaoningZhang/MobileSAM`, added for the run with `uv run --with timm --with mobile-sam@git+...`) and called `parfocal_ml.sam_onnx.export.export_encoder` and `export_decoder` into a separate folder, so the graphs carry PathoSAM's file names. The ONNX encoder matched PyTorch on the first TNBC image at a largest absolute embedding difference of 3.6e-6 against a largest value of 0.58.

The scratch bench script built `OnnxSam("pathosam.encoder.onnx", folder=...)` from `parfocal_ml.interactive` and called its `run` and `summarise` on all of `samples("tnbc")`. Prompts, best of four masks, `mask_input` feedback, contour outlines and scoring are therefore exactly those of the [interactive protocol result](2026-11-06-interactive-protocol-on-tnbc.md), which reproduced POC doc 26 within 0.004. The one difference is that MobileSAM ran an fp32 encoder and the PathoSAM row a uint8 one.

The export script, run with `uv run --package parfocal-ml --extra export --with timm --with "mobile-sam @ git+https://github.com/ChaoningZhang/MobileSAM" python export_mobilesam.py CHECKPOINT FOLDER`:

```python
import sys
from pathlib import Path

import torch
from mobile_sam import sam_model_registry

from parfocal_ml.sam_onnx import export

checkpoint = Path(sys.argv[1])
folder = Path(sys.argv[2])
state = torch.load(checkpoint, map_location="cpu", weights_only=True)
sam = sam_model_registry["vit_t"]()
sam.load_state_dict(state, strict=True)
sam.eval()
print(export.export_encoder(sam, folder))
print(export.export_decoder(sam, folder))
```

The bench script, run with `uv run --package parfocal-ml --extra onnx python bench_folder.py FOLDER pathosam.encoder.onnx all OUT`:

```python
import itertools
import json
import sys
import time
from pathlib import Path

from parfocal_ml.datasets import samples
from parfocal_ml.interactive import OnnxSam, median, run, summarise
from parfocal_ml.sam_contract import GRAPHS

folder = Path(sys.argv[1])
encoder = sys.argv[2]
count = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "all" else None
out = Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
model = OnnxSam(encoder, folder=folder)
started = time.perf_counter()
outcomes = list(run(model, itertools.islice(samples("tnbc"), count), out / "nuclei.jsonl"))
report = {
    "encoder": encoder,
    "decoder": GRAPHS.decoder,
    "images": len({o.image for o in outcomes}),
    "summary": summarise(outcomes),
    "seconds": round(time.perf_counter() - started, 1),
    "encode_ms_median": median(model.encode_ms),
    "decode_ms_median": median(model.decode_ms),
    "decodes": len(model.decode_ms),
}
(out / "summary.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
```

## Results

Mean IoU per nucleus on all 50 TNBC images.

| Prompt | Nuclei | PathoSAM ViT-B, uint8 encoder | MobileSAM, fp32 | Standard error | Difference |
|---|---|---|---|---|---|
| Ideal click | 3,466 | 0.8529 | 0.5744 | 0.0053 | -0.279 |
| Realistic click | 3,466 | 0.8522 | 0.5733 | 0.0053 | -0.279 |
| Exact box | 3,466 | 0.8632 | 0.7910 | 0.0016 | -0.072 |
| Loose box | 3,466 | 0.8169 | 0.7652 | 0.0020 | -0.052 |
| Two clicks | 856 | 0.8745 | 0.6757 | 0.0095 | -0.199 |
| Three clicks | 856 | 0.8806 | 0.7258 | 0.0085 | -0.155 |

| Metric | PathoSAM ViT-B | MobileSAM |
|---|---|---|
| Realistic clicks at IoU 0.75 or better | 88.95% | 45.67% |
| NoC@85, mean (never in 20) | 3.098 (3.97%) | 9.52 (31.54%) |
| NoC@90, mean (never in 20) | 7.563 (18.57%) | 16.17 (70.56%) |
| Median encode, CPU | 2,165 ms (uint8) | 370 ms (fp32) |
| Median decode, CPU | 21.1 ms | 24.2 ms |

The MobileSAM encoder graph is 28.0 MB. The run took 2,258 s for 27,055 decodes, more than PathoSAM's 20,288 because more refinement trajectories ran to the 20 click cap.

## Interpretation

- Generic MobileSAM is not a Fast tier model. It loses 0.28 on a click and 0.07 on an exact box, the same pattern POC doc 26 found for SAM 2 Hiera-L and SlimSAM-77: a generic SAM finds a nucleus from a box but not from one point on a small object.
- Its encoder is about six times faster than PathoSAM's uint8 ViT-B on the same CPU, so the speed case for a small SAM holds. Part of that gap may come from fp32 against dynamic uint8 kernels, which was not measured separately.
- The box gap is small enough that a fine-tune on PathoSAM's public training sets could plausibly close it, but the click gap is what the smart select tool depends on. Whether a fine-tune closes 0.28 is unmeasured.

## Follow-ups

- A fine-tune of MobileSAM or EdgeSAM on PathoSAM's training sets, then this run again. That is a GPU training run, decision XXX in `docs/decisions.md`.
- WebAssembly and WebGPU timings of the MobileSAM encoder in Chrome were not taken, because the accuracy rules it out first.
