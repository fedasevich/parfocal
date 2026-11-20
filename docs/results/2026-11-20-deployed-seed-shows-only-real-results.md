# Result: every AI result set on the reseeded deployed app carries a real model output

- Date: 2026-11-20
- Backlog: TEST-051 (every seeded AI result comes from real inference)
- Kind: deployed check
- Commit: `cf89e64a` (v0.27.1 as deployed on app.parfocal.eu, seeded at 07:16 UTC on 2026-11-20)
- Environment: Python `urllib` with the agent test account's session from `scripts/agent_session.py`
- Data: the three seeded ČVUT workspaces `cvut-biomedical`, `cvut-ml` and `cvut-imaging`, no PHI

## Question

The last wait of TEST-051 is a look at the deployed demo after a reset: does it show only results from real model runs, and does the result file that "Done when" asks for exist?

## Method

For each of the three workspaces the script switched the session's active workspace with `PUT /api/me/workspace`, then read `GET /api/projects`, every slide with `GET /api/me/slides?project_id=…`, and every set with `GET /api/slides/{id}/result-sets`. At the end it switched back to the workspace the session started in. Nothing else was written. Each set's cell and region counts were compared with the files in `packages/test-fixtures/model-results/` and the table of the [2026-11-19 result](2026-11-19-real-inference-seed.md).

## Results

123 result sets across the three workspaces, 45, 39 and 39.

| Set name | Model label | Source file | Status | Sets |
|---|---|---|---|---:|
| Tumour detector v1 | MONAI tumour detection 0.6.4, ONNX | `regions.parfocal.json` | ready | 57 |
| Cell typer v1 | InstanSeg v0.1.1, HoVer-NeXt PanNuke typer | `cells.geojson` | ready | 42 |
| Tumour detector v1 | MONAI tumour detection 0.6.4, ONNX | `cells.csv`, `cells.geojson` or `heatmap.png` (state cases) | ready | 18 |
| Tumour detector v1 | MONAI tumour detection 0.6.4, ONNX | `run.geojson` ("Case ai-running") | importing, 0 objects | 3 |
| Broken import | none | `broken.csv` | failed, 0 objects | 3 |

| Gallery slide | Cells on the app | Cells in the fixture file | Regions on the app |
|---|---:|---:|---:|
| test_065 | 2,038 | 2,038 | 1 |
| Philips-4.tiff | 5,719 | 5,719 | 1 |
| CMU-1-Small-Region.svs | 1,418 | 1,418 | 6 |
| JP2K-33003-1.svs | 223 | 223 | 11 |
| CMU-1-JP2K-33005.svs | 3,982 | 3,982 | 1 |
| CMU-1-JP2K-33005-v2.zip | 3,982 | 3,982 | 1 |
| CMU-1.ndpi | 2,873 | 2,873 | 5 |
| Leica-1.scn | 603 | 603 | 4 |
| OS-1.bif | 26 | 26 | 15 |
| Philips-3.tiff | 4,393 | 4,393 | no set |
| Huron-1-40x.tif | 386 | 386 | 2 |
| Argos-1.avs | 2,017 | 2,017 | 6 |
| CMU-1.tiff | 2,965 | 2,965 | 3 |

Every region count above equals the "Regions" column of the 2026-11-19 result. The state and style cases hold 2, 6 or 11 regions, the counts of Huron-1-40x (2), CMU-1-Small-Region or Argos-1 (6) and JP2K-33003-1 (11). No set holds the 24 drawn cells or three drawn squares of the old `showcase_shapes.py`, which no longer exists in the repository. The two seed tests that guard this, `test_every_seeded_ai_result_comes_from_a_model_run` in `apps/api/tests/test_showcase.py` and `test_every_sample_region_comes_from_a_model_run` in `apps/api/tests/test_sample_project.py`, are in the repository.

## Interpretation

The deployed demo after the 2026-11-20 reset shows only sets labelled with the two real models, with counts that equal the model run files. The importing set on "Case ai-running" and the failed "Broken import" hold no objects, as the seed means them to. With the [2026-11-19 result](2026-11-19-real-inference-seed.md) listing every slide's model, crop, time and cost, all three parts of "Done when" hold.

This check compared counts and labels, not each outline's coordinates. The seed test compares the outlines.

## Follow-ups

- TEST-051 can be ticked.
- The "Sample · sentinel nodes" project, which a member creates from the API, was not created for this check, so its sets were not looked at here.
