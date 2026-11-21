# Result: 99 of 105 slides on the deployed app return a thumbnail, and test_065 and Missing file.svs answer 204 in every workspace

- Date: 2026-11-21
- Backlog: INGEST-032 (every slide on the deployed app has a thumbnail)
- Kind: production measurement
- Commit: `ad05cea` (v0.35.12 as deployed on app.parfocal.eu, just after the reseed of GitHub Actions run 44956558900)
- Environment: Playwright 1.65.1 request context on a MacBook, signed in as the agent test account with its own session
- Data: the three seeded ČVUT workspaces, no PHI

## Question

Does every slide the agent test account can see return 200 from `GET /api/slides/{slide_id}/thumbnail`?

## Method

For each of the account's three workspaces, the script switched the session to it with `PUT /api/me/workspace`, listed every slide through `GET /api/me/slides` until `next_cursor` was empty, and fetched each slide's thumbnail. It then switched back to the first workspace.

## Results

| Workspace | Slides | 200 | 204 |
|---|---:|---:|---:|
| cvut-biomedical | 35 | 33 | 2 |
| cvut-ml | 35 | 33 | 2 |
| cvut-imaging | 35 | 33 | 2 |
| All | 105 | 99 | 6 |

Every 200 was `image/jpeg`. The 204 answers, with no body, came from these slides in each workspace.

| Slide | What it is |
|---|---|
| `test_065` | the TNBC image that the Best one-click checks and the typer smoke use |
| `Missing file.svs` | a seeded slide whose file is missing on purpose |

## Interpretation

- The done line is not met. `test_065` opens in the viewer and its GPU calls work, so its thumbnail is missing from the seed and not because its file is gone.
- `Missing file.svs` has no file, so its 204 may be the intended answer. The done line names every slide, so the owner or the task should say whether this slide is exempt.

## Follow-ups

- `TODO` find why the seed writes no thumbnail for `test_065` and extend the seed test so it covers this slide.
- `TODO` decide whether a slide seeded without a file counts for INGEST-032.
