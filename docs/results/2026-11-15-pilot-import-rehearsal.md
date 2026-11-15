# Result: pilot import rehearsal on the local stack

- Date: 2026-11-15
- Backlog: PILOT-004 (pilot data onboarding)
- Kind: check
- Commit: 6d4a5d0f (PILOT-004, import with cases from names)
- Environment: Apple M4 with 24 GB, macOS 15.8.1, local Postgres and MinIO from `compose.yaml`, the API under uvicorn on a free port with the production upload limits, the ingest worker inline in a thread. Five other agents shared the machine.
- Data: four public OpenSlide slides from the fixture cache under pilot-shaped names, and three copies of `workers/ingest/tests/fixtures/results/regions.geojson`. No PHI.

## Question

Does the bulk import command, run with a real service account token over HTTP, bring a pilot-shaped folder of slides and AI results into cases taken from folder and file names, and does a second run send nothing? No staging or drill environment exists, so this stands in for the drill until one does.

## Method

`PARFOCAL_PILOT_REHEARSAL=1 uv run --package parfocal-api pytest tests/test_pilot_rehearsal.py -m db -q` from `apps/api`. The test builds a fresh database, a workspace with one project, and a service account with `see-slides`, `create-cases` and `upload-slides`. It then runs `python -m parfocal_api.bulk_import FOLDER --project ID --api URL --cases-from-names` three times through `main()`: with `--dry-run`, with `--wait 900 --import-as-is`, and again with `--wait 60`. At the end it deletes the workspace's objects from MinIO.

The folder:

| Path | Source | Bytes |
|---|---|---|
| `S26-0901/S26-0901_A1_HE.svs` | `CMU-1-Small-Region.svs` | 1,938,955 |
| `S26-0901/S26-0901_A1_HE.geojson` | `regions.geojson` | 1,255 |
| `S26-0902_B1_HE.svs` | `CMU-1.svs` | 177,552,579 |
| `S26-0902_B1_HE.geojson` | `regions.geojson` | 1,255 |
| `S26-0903/S26-0903_C1_HE.ndpi` | `CMU-1.ndpi` | 198,030,965 |
| `S26-0903/S26-0903_C1_HE.geojson` | `regions.geojson` | 1,255 |
| `S26-0903/S26-0903_C2_HE.tif` | `Huron-1-40x.tif` | 115,718,398 |

## Results

| Run | Exit | Summary line |
|---|---|---|
| Dry run | 0 | 3 new cases, 0 existing, 0 files sent, 0 failed, and no case created |
| Import | 0 | 3 new cases, 0 existing, 7 files sent, 0 failed, every file `ready` |
| Second run | 0 | 0 new cases, 3 existing, 0 files sent, 0 failed, slides `already-in-case`, results `already-imported` |

| Case | Published slides | Result sets |
|---|---|---|
| S26-0901 | 1 | 1 |
| S26-0902 | 1 | 1 |
| S26-0903 | 2 | 1 |

The three cases have no author and the source `upload`. Upload, ingest and result import together took 13.6 s in the test run and 17.9 s in an earlier run of the same steps from a scratch script, for 493 MB.

## Interpretation

The command works end to end with a service account. A drop of new cases needed one API fix first: `applyDroppedFiles` refused service accounts with `members-only`, and it now creates the cases without an author, as the case CSV import does. The times are for local MinIO on one disk and say nothing about R2 over a real uplink.

## Follow-ups

- The real dry run with the pilot sample in a drill environment is still owed. The steps are in [knowledge/pilot-onboarding.md](../knowledge/pilot-onboarding.md).
- TODO: time a real pilot folder against R2, which only that run can measure.
