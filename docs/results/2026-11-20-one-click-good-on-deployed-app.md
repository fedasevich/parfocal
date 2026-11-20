# Result: a Good one-click outline is drawn, accepted and still there after a reload on the deployed app

- Date: 2026-11-20
- Backlog: PROTO-036 (one-click annotation has its model picker and works end to end)
- Kind: deployed check
- Commit: `cf89e64a` (v0.27.1 as deployed on app.parfocal.eu)
- Environment: MacBook with Apple M4 and 24 GB, macOS 15.8.1, Playwright 1.65.1 with its headless Chromium shell build 1248, viewport 1440 by 900, signed in as the agent test account with `scripts/agent_session.py`
- Data: `test_065` in the seeded project "Vendor format robustness" of the `cvut-ml` workspace, no PHI

## Question

The deployed half of PROTO-036 waits for two things. Are the four PathoSAM ViT-B ONNX files in R2 `parfocal-dev-eu/models/`, and does the deployed app pick Good in Smart select, outline one clicked nucleus, accept it and show it again after a reload?

## Method

1. Listed the objects under `models/` in the bucket `parfocal-dev-eu` (jurisdiction `eu`) with one read-only call to the Cloudflare R2 list objects API. Nothing was written.
2. A Playwright script loaded the saved agent session, opened `test_065` centred on a tumour nucleus from `packages/test-fixtures/model-results/test-065/cells.geojson` with `?x=…&y=…&z=128`, pressed `s` for Smart select, opened the model pill, hovered and picked Good, clicked the stage centre, waited for the smart layer to reach `data-phase="ready"` with a live outline, clicked Accept, waited for `data-save-state="saved"`, reloaded and counted the `polygon-shape` elements.
3. The saved outline was then deleted with the annotations API (`DELETE /api/slides/{slide}/annotations/{id}?version=1`, answered 204), so the slide holds no test shape.

## Results

| Object in `parfocal-dev-eu/models/` | Bytes | Uploaded (UTC) |
|---|---:|---|
| `pathosam.encoder_q4.onnx` | 72,564,336 | 2026-11-18 21:39:41 |
| `pathosam.encoder_uint8.onnx` | 100,742,890 | 2026-11-18 21:39:52 |
| `pathosam.decoder.onnx` | 16,495,823 | 2026-11-18 21:40:00 |
| `pathosam.decoder_window32.onnx` | 16,496,090 | 2026-11-18 21:40:07 |

The sizes equal `graphBytes` in `apps/web/src/aiseg/one-click-tiers.ts`. The bucket also holds the two ViT-L decoders, the ViT-L encoder under `models/pathosam-vit-l/v1/`, the tumour and typer models and the sign-in image.

| Step on the deployed app | Seen |
|---|---|
| Model pill after `s` | Best by default, picker titled "Model for outlining nuclei" with two radios, Best and Good |
| Good's line on hover | "PathoSAM ViT-B · on this computer, on the graphics card · 106 MB, downloaded once" |
| Files fetched for Good | `pathosam.decoder.onnx`, `pathosam.encoder_uint8.onnx` and `pathosam.decoder_window32.onnx` from `/models/`, all 200 on first load |
| Click to ready outline | 8,098 ms, one proposal, confidence 0.90, no `data-encoder` because Good runs in the browser |
| Shapes before and after Accept | 0 and 1, save state `saved` |
| Shapes after a reload | 1 |
| Annotations on `test_065` after the cleanup delete | 0 |

The browser console showed two 409 answers while the home page loaded and one 404 right after the picker opened. The URLs were not recorded, and none of them stopped the flow.

## Interpretation

Both waits on the board are met. The four ViT-B files are in the EU bucket, and the deployed app picks Good, outlines a clicked nucleus on a seeded slide, saves it and loads it back. The browser test half of "Done when" was met earlier by `apps/web/e2e/smart-select.spec.ts`.

## Follow-ups

- PROTO-036 can be ticked.
- `TODO` find the 404 seen after the picker opens and the two 409s on the home page, which this check did not identify.
