# 0420. A worker leaves a staged upload the bucket lock keeps, and background jobs wait behind uploads

- Date: 2026-11-21
- Status: Accepted
- Deciders: agent on PROTO-150
- Backlog: PROTO-150 (upload and model run jobs tell one story and Run a model offers only served models)

## Context

The deployed walkthrough of v0.35.3 uploaded CMU-1-Small-Region.svs twice. Both ingest jobs sat queued for nine minutes and then failed with `too-many-claims`, while the slides were published and usable. The Modal logs and the jobs table show two causes.

1. The reseed at 04:11 UTC queued 90 `cell-crops` jobs. The ingest function runs at most two containers and claims jobs oldest first, so the uploads waited until the last crop job ended at 04:32.
2. The publish step commits the slide, then deletes the staged upload under `t/`. The seven day bucket lock `keep-tenant-objects` (OPS-009, the bucket lock on tenant objects) refuses that delete with 409 `ObjectLockedByBucketPolicy`. The step ran three times and the job failed, though the upload done notice had already been sent.

## Options considered

1. Move staged uploads out of `t/`, so the lock never covers them. This needs a new prefix in the API, the worker and the bucket rules, and a tofu change to the lock, which must be asked first.
2. Treat the lock refusal of a staged upload as done. The staged copy stays until the lock lets go, and the lifecycle rule moves it to cheaper storage meanwhile.
3. Give each job kind a priority and claim interactive kinds first. Uploads and result imports never wait behind bulk work on the ingest worker.

## Decision

Options 2 and 3. `ObjectStore.discard_object` deletes a key and returns false when only the bucket lock refused. The ingest publish and refuse steps and the result import use it for the staged upload. Any other storage error still fails the step. A `Workflow` may say it is `background`, and `claim` orders background kinds after every other kind it drains, then by age. Cell crops are background.

## Consequences

- A staged upload copy stays in R2 for up to seven days after its slide is published. At 2 MB to 1 GB a slide this costs cents a month. Option 1 stays open if the copies ever matter.
- A crop backlog still takes as long as before, but an upload claims the next free container.
- Restricted label images of a de-identified project are deleted under `t/` too, and the lock refuses that delete the same way. That path still fails the job. Whether those images may stay for seven days is a question for the owner, raised in the PROTO-150 hand-back.
