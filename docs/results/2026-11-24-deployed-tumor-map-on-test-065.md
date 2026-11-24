# Result: a tumor map on the seeded test_065 opened the slide from its sample folder and scored 237 of 331 tiles on app.parfocal.eu, then failed on R2 answering 503

- Date: 2026-11-24
- Backlog: OPS-036 (view maps and tumor maps open a seeded slide from the folder beside its original)
- Kind: deployed check
- Environment: `https://app.parfocal.eu` on v0.51.0, a development environment ([ADR 0390](../adr/0390-app-parfocal-eu-is-a-development-environment.md), the deployed app is dev). The job ran in the Modal app `parfocal-gpu-pool`, environment `main`
- Data: the seeded CAMELYON16 slide `test_065` in the project "Scanner format comparison" of `cvut-biomedical`, a public dataset

## Question

Does a tumor map started from the deployed app open a seeded slide whose original sits in a shared sample folder, and finish?

## Method

1. Signed in as agent-walk with `scripts/agent_session.py`. `GET /api/me` showed the account as a researcher with admin rights in `cvut-biomedical`, and it owns the project, so it holds the "run models" right.
2. At 22:23:30 UTC sent `POST /api/projects/{project}/slides/{test_065}/tumor-maps`. It answered 201 with job `98d9ff93-474d-4f98-86e9-e1141f79938d` and result set `2c762641-bbed-49e9-a3ec-1c2009e847b1`.
3. Polled the result set every 30 s, read the job with `GET /api/projects/{project}/jobs/{job}` and the pool's log with `modal app logs parfocal-gpu-pool --env main`.

## Results

| Field | Value |
|---|---|
| Started | 2026-11-24 22:23:30 UTC |
| Job finished | 2026-11-24 22:35:29 UTC, `failed`, error code `too-many-claims` |
| Step `map-scored` | failed after 3 runs, 237 of 331 tiles done |
| Step `map-stored` | pending, never ran |
| Result set at 22:38 | still `importing` |
| Modal cost | `TODO`. The cost report read at 22:39 UTC still showed production Modal at $28.39, the same as at 22:24 UTC, so billing had not caught up |

The pool log shows the three claims. The first container was preempted by Modal and restarted with the same input. The next two each crashed with `parfocal_common.object_store.StorageError: 503 ServiceUnavailable` raised from `ObjectStore.put_object` while `score_tiles` stored a scored tile. After the third claim the job runner failed the job.

## Interpretation

- The folder fix of OPS-036 works on the deployed app. The job opened `test_065` from its sample folder and scored 237 tiles, where before it stopped at once with `tumor-map-slide-missing`.
- The map did not finish, so the "Done when" line is not met yet. The cause is outside OPS-036: `ObjectStore.send` raised on the first 503 from R2, and two claims in a row died that way, the last about 37 s after it started. Whether R2 answered 503 by chance or throttled the tile writes is not known, so the retry below is unproven until a rerun after a deploy.
- A job failed by the claim limit leaves its result set in `importing`, because that path in `claim` does not call the job's settle hooks. Not fixed here. The stuck result set `2c762641` was deleted through `DELETE /api/result-sets/{id}` at the end of the check, so `test_065` carries no half map.

## Follow-ups

- Fixed on the branch: `ObjectStore.send` now retries 429, 500, 502, 503 and 504 up to four attempts, waiting 0.5, 1 and 2 s, and still fails after the last attempt or at once on any other error (`packages/py-common/tests/test_object_store_retries.py`).
- `TODO` after the fix is released and deployed, run one tumor map on `test_065` again and record its time and cost here.
- `TODO` settle the result set of a job that fails on the claim limit, in a task of its own.
