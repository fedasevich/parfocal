# Result: PathoSAM ViT-L AIS gains about 0.03 PQ over ViT-B on TNBC and NuInsSeg but ties on CryoNuSeg, InstanSeg falls behind on CryoNuSeg, so neither clears the bar and the line-up stays for now

- Date: 2026-11-16
- Backlog: AINUC-015 (score newer nucleus models on the Mac), following AINUC-000 (nuclei detector and typer research check) and decision 123 (newer nucleus models), option A
- Kind: ML evaluation
- Commit: the AINUC-015 commit on branch `claude/wonderful-khorana-cea231`, module `parfocal_ml.nucleus_lineup`. The same-path ViT-B rerun ran on 2026-11-18 from merged main at 3f27c753 with the module unchanged, on the CPU with `--threads 4`
- Environment: MacBook with Apple M4 (10 cores) and 24 GB, macOS 15.8.1, Python 3.14.10, torch 2.15.0 on CPU, numpy 2.5.4, segment-anything 1.0. One ML job at a time. Other non-ML agents shared the machine, so times are indicative only
- Data: the POC's held-out fixtures in `poc/server/fixtures` (read only, nothing committed, no PHI). TNBC, all 50 images, 4,056 nuclei. NuInsSeg, every tenth image as in POC doc 26 (held-out benchmarks), 67 images, 2,456 nuclei, vague areas ignored. CryoNuSeg, all 30 images, 8,899 nuclei, the POC's repaired annotator 1 masks. All at 0.25 µm/px. `~/.cache/parfocal/datasets/cryonuseg/` is still empty, so CryoNuSeg comes from the POC fixture and not from the MLEVAL-010 (loaders for datasets behind a sign-in) archive

## Question

Does either model that decision 123 allowed, InstanSeg or the PathoSAM ViT-L AIS decoder, beat the kept detector, PathoSAM ViT-B AIS, on sets it did not train on? ADR 0349 (nucleus detector and typer per tier) kept ViT-B because no other detector had a held-out number here.

The bar was written after a one-image smoke run and before the full runs: a candidate clearly beats ViT-B only if its pooled PQ is at least 0.02 higher on every set held out for it and no more than 0.01 lower on any. InstanSeg's README lists tnbc_2018 and NuInsSeg among its training sets ([InstanSeg result](2026-11-16-instanseg-on-tnbc-and-wasm.md)), so only CryoNuSeg counts for it. PathoSAM's paper holds out all three sets.

## Models, sizes and licences

| Model | Files | Bytes | Hash check | Licence |
|---|---|---|---|---|
| PathoSAM ViT-L encoder | `vit_l_histopathology.pt` from the micro-sam registry link `owncloud.gwdg.de/index.php/s/IZgnn1cpBq2PHod` | 1,249,494,242 | xxh128 b591833c89754271023e901281dee3f2, equal to the registry. SHA-256 9e65d8f4…f331440 | Code MIT. Weights `TODO`, no licence found, trained on a set that includes non-commercial data (ADR 0042, model licensing policy, Rejected) |
| PathoSAM ViT-L AIS decoder | `vit_l_histopathology_decoder.pt` from `owncloud.gwdg.de/index.php/s/oIs6VSmkOp7XrKF` | 44,143,988, the same size as the ViT-B decoder | xxh128 46aab7765d4400e039772d5a50b55c04, equal to the registry. SHA-256 7ec0da1e…bf81662c, different from ViT-B's | As above |
| InstanSeg brightfield nuclei | already on the Mac from AISEG-013 (fast tier in the browser without a GPU), `brightfield_nuclei.zip` of release `instanseg_models_v0.1.1` | 15,054,316 | SHA-256 as in the InstanSeg result | Apache-2.0 per its `rdf.yaml` |
| PathoSAM ViT-B AIS, the kept detector | already on the Mac | 375,023,106 and 44,143,988 | SHA-256 in `sam_contract.py` | As for ViT-L |
| HoVer-Net (MONAI CoNSeP bundle), the POC's earlier whole-slide detector | not loaded, its stored POC predictions are re-scored. Its weights are not on the Mac, so it has no size or peak RAM here | | | As in ADR 0042 |

Both ViT-L files loaded with `strict=True` into `segment_anything`'s `vit_l` encoder and this repository's `InstanceDecoder`.

## Method

```
pnpm --filter @parfocal/ml bench:nucleus-lineup -- --model pathosam-vit-l --dataset cryonuseg
pnpm --filter @parfocal/ml bench:nucleus-lineup -- --model instanseg --dataset nuinsseg
pnpm --filter @parfocal/ml bench:nucleus-lineup -- --model pathosam-vit-b-poc --dataset tnbc
```

and the same for every model and set. With pnpm 12 the `--` reaches the script and argparse rejects it, so the 2026-11-18 ViT-B rerun called `uv run --package parfocal-ml --extra export python -m parfocal_ml.nucleus_lineup --model pathosam-vit-b --dataset tnbc --threads 4` from `workers/ml` instead. `parfocal_ml.nucleus_lineup` loads the POC fixtures, runs one detector per image and scores the rings with `parfocal_ml.scoring`, the scorer AINUC-000 used. The PathoSAM models run in PyTorch through the server runner's own path: `pixel_values`, the encoder, the full 1,024 px AIS decoder, `half_pixel_resize` and `nuclei.outlines_of`. InstanSeg runs its unmodified TorchScript model at its 0.5 µm/px, so a 512 px image becomes a 256 px input. `hovernet` and `pathosam-vit-b-poc` re-score the POC's stored `hovernet-batch` and `pathosam-ais-batch` predictions, which are the PyTorch reference that AINUC-001 (nucleus detector runner) reproduced. Peak RAM is `ru_maxrss` of the scoring process, so it includes the loaded weights, the images and the scorer.

Metrics are pooled over nuclei, as AINUC-000 reported them, plus PQ and F1 averaged over images, the form POC doc 26 used. The stored POC predictions give exactly the doc 26 numbers in both forms (TNBC 0.828, NuInsSeg 0.524, CryoNuSeg 0.483 pooled, HoVer-Net 0.447, 0.000 and 0.187 per image), and `tests/test_nucleus_lineup.py` checks the ViT-B ones.

## Results

Pooled PQ, with F1 at IoU 0.5 in brackets, then the mean PQ over images.

| Model | TNBC | NuInsSeg | CryoNuSeg | Held out for it |
|---|---|---|---|---|
| PathoSAM ViT-B AIS, kept, stored POC prediction | 0.828 (0.952), 0.829 | 0.524 (0.696), 0.488 | 0.483 (0.632), 0.471 | all three |
| PathoSAM ViT-B AIS, kept, rerun on this module's path | 0.828 (0.952), 0.829 | 0.524 (0.695), 0.488 | 0.483 (0.632), 0.471 | all three |
| PathoSAM ViT-L AIS | 0.854 (0.957), 0.850 | 0.554 (0.734), 0.523 | 0.481 (0.630), 0.465 | all three |
| InstanSeg brightfield nuclei | 0.712 (0.887), 0.716, in its training data | 0.694 (0.875), 0.681, in its training data | 0.439 (0.577), 0.421 | CryoNuSeg only |
| HoVer-Net, POC whole-slide job until doc 26 | 0.512 (0.682), 0.447 | 0.000 (0.000), 0.000 | 0.190 (0.276), 0.187 | all three |

Recall and precision on CryoNuSeg, the one set held out for every model: ViT-B 0.538 and 0.767, ViT-L 0.534 and 0.767, InstanSeg 0.446 and 0.816, HoVer-Net 0.174 and 0.666.

Cost per 512 px image on the M4 CPU:

| Model | Median time per image | Peak RAM, one image | Peak RAM, full run |
|---|---|---|---|
| PathoSAM ViT-B AIS | 6.5 to 8.2 s | 6.90 GB, and 6.94 GB over 5 TNBC images with 4 threads | 8.09 GB on TNBC, 8.04 GB on NuInsSeg, 8.05 GB on CryoNuSeg, with 4 threads |
| PathoSAM ViT-L AIS | 10.4 to 11.5 s | 6.32 GB | 8.66 GB on CryoNuSeg, 9.01 GB on NuInsSeg, 9.00 GB on TNBC |
| InstanSeg | 0.29 to 0.58 s | 0.80 GB | 1.17 to 1.30 GB |

On the first TNBC image, ViT-B through this module's runner path scores PQ 0.8815 and the stored POC prediction 0.8822, so the two ViT-B paths agree.

## Interpretation

- Neither candidate clears the bar. ViT-L is 0.026 PQ above ViT-B on TNBC (0.854 against 0.828) and 0.030 on NuInsSeg (0.554 against 0.524), mostly from precision on NuInsSeg (0.813 against 0.757), but it ties on CryoNuSeg (0.481 against 0.483), the frozen-section set where both miss about half the nuclei.
- The same-path ViT-B rerun gives the stored POC numbers to the third decimal on all three sets (pooled PQ 0.8282, 0.5236 and 0.4833, recall and precision 0.538 and 0.767 on CryoNuSeg). So ViT-L's gains of 0.026 on TNBC and 0.030 on NuInsSeg come from the model, not the path.
- InstanSeg is 0.044 PQ below ViT-B on CryoNuSeg, its only held-out set, mostly from recall (0.446 against 0.538). Its high NuInsSeg score is in-domain and cannot be compared. It stays what decision 134 (InstanSeg as the auto tool without WebGPU) made it, the browser fallback where speed decides, and does not replace ViT-B on the server.
- ViT-L costs about 1.3 to 1.5 times ViT-B's time per image and a 1.25 GB file. ADR 0349 lets ViT-L return to Best once it beats ViT-B's TNBC PQ of 0.828 on the same scorer, which 0.854 does on TNBC alone, but the stricter bar fixed for this task, every held-out set, is not met. Whether ViT-L returns to Best is decision 146 (PathoSAM ViT-L for the Best tier) in `docs/decisions.md`.
- HoVer-Net confirms POC doc 26: it is far below every SAM-based detector and finds nothing on NuInsSeg.
- The ViT-L full runs peaked at 8.66 to 9.01 GB, over the owner's guide of about 8 GB, while one image peaks at 6.3 GB. The growth across images looks like allocator reuse, not a leak, but it was not investigated. A rerun should cap it, for example with fewer threads or one process per image batch.

## Not done

- CryoNuSeg through the MLEVAL-010 archive loader. On 2026-11-18 `~/.cache/parfocal/datasets/cryonuseg/` still did not exist, so CryoNuSeg stays scored from the POC fixture.
- A ViT-L rerun capped under 8 GB. ViT-B with 4 threads also ends near 8.05 GB over a full set, so the growth is not only threads. One process per batch of images would cap both.
- HoVer-NeXt as a detector. Only its foreground scores are stored in the POC fixtures, not instances.
