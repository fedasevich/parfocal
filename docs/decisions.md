# Decisions waiting for the owner

Last updated: 2026-11-20

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

- **Delete the US bucket `parfocal-dev`**, now. OPS-037 (nothing reads the US bucket) is merged and main CI read every fixture from the EU bucket on 2026-11-20. Every reader now uses `parfocal-dev-eu`, which holds every object the US bucket had. The delete cannot be undone. It frees 38.1 GB in 3,489 objects, about $0.57 a month, and costs nothing, since R2 deletes are free. Three steps, about ten minutes plus the dashboard's background emptying:
  1. Remove the bucket lock, because a locked bucket cannot be emptied: `bash infra/tofu/tofu.sh dev apply -target=cloudflare_r2_bucket_lock.retired_us`. The plan shows 1 to destroy.
  2. In the Cloudflare dashboard open R2, `parfocal-dev`, Settings, and select Empty under Empty Bucket. Wait until it shows the bucket empty.
  3. `bash infra/tofu/tofu.sh dev apply`. The plan shows 0 to add, 0 to change, 4 to destroy: the bucket `parfocal-dev`, its CORS rule, its lifecycle rules and the US read-only token `parfocal-fixtures-read`. Then delete the two GitHub secrets that held that token: `gh secret delete PARFOCAL_FIXTURES_R2_ACCESS_KEY_ID` and `gh secret delete PARFOCAL_FIXTURES_R2_SECRET_ACCESS_KEY`. If you like, also delete the account token "parfocal-dev local" in Cloudflare, Manage account, Account API tokens, since it reaches only that bucket.

## Later

- **Production for the first real user.** Say when, and the lead books the deploy session.

## Open questions

### 165. May converted MIRAX and DICOM slides use JPEG tiles instead of lossless?

ADR 0408 (MIRAX and DICOM zips become one tiled TIFF at ingest) stores the converted slide losslessly, so every pixel matches the source. The DICOM fixture came out at 1.08 GB, 8.4 times its zip. At that rate 100 DICOM slides of 1 GB would cost about $13 a month in R2.

- A. JPEG at quality 90. Near the source size, with tiny pixel differences an AI comparison might notice.
- B. Keep lossless. Exact pixels, about 8 times the storage. (Recommended while only test slides exist, since the cost today is about $0.02 a month.)

Your choice:

### 166. Which task carries training data from reviewed AI objects?

From the map of the path from an uploaded slide to training annotations (`docs/results/2026-11-20-annotate-review-export-path.md`).

Review tasks have independent reviewers, decisions and adjudication, and no training export. Annotate tasks have one shared layer with full history and the training export, and no adjudication.

- A. Both, joined at the end. A signed off review task is turned into a final layer that the existing dataset builder reads. One export for everything, and a doctor's corrections become training data. One large task and an ADR. (Recommended.)
- B. Only annotate tasks make training data. Review tasks only measure the model. Nothing to build but buttons, and review corrections are not used for training.
- C. Merge the two kinds into one task with a switch for independent work. The simplest model to explain, and the largest rewrite, touching decisions, the queue, sign off and every export.

Your choice:

### 167. When two reviewers draw different outlines for one object, who settles it?

From the map of the path from an uploaded slide to training annotations (`docs/results/2026-11-20-annotate-review-export-path.md`).

- A. The adjudicator picks one of the outlines or draws a new one. Outlines count as different below a set overlap, changeable per task. The starting value is TODO and is picked in the task from fixture outlines. (Recommended.)
- B. A rule merges them with no person, for example the area most reviewers marked. No extra work, but a shape nobody drew enters the data.
- C. Shapes are not compared and the latest edit wins.

Your choice:

### 168. Which training formats come next after QuPath GeoJSON and patches with masks?

From the map of the path from an uploaded slide to training annotations (`docs/results/2026-11-20-annotate-review-export-path.md`).

- A. COCO JSON beside the patch tiles. (Recommended, it is the format you named and the most widely read.)
- B. COCO and also instance maps per tile for nucleus models in the HoVer-Net style.
- C. Nothing more for now.

Your choice:

### 169. What is a dataset version?

From the map of the path from an uploaded slide to training annotations (`docs/results/2026-11-20-annotate-review-export-path.md`).

- A. A frozen copy of the manifest and the GeoJSON, stored write once with a number and a checksum. Patches are cut again from it when asked. Small files, exact repeat. Storage cost per version: TODO, to be measured in the task. (Recommended.)
- B. A frozen copy of everything, tiles included. Exact and fast to download again, and the largest storage use.
- C. Only a saved recipe (task, filters, time) that is built again on demand. No storage, but a later change after sign off can make the same recipe give different data.

Your choice:

### 170. Which objects go into a dataset by default?

From the map of the path from an uploaded slide to training annotations (`docs/results/2026-11-20-annotate-review-export-path.md`).

- A. Only objects a person checked: agreed or confirmed, edited and added. Objects answered unsure or left open are left out and counted. (Recommended.)
- B. The same, plus unchecked AI objects marked `ai-unchecked`, as the annotate export can already do by a task option.
- C. Everything, with the origin left to the researcher to filter.

Your choice:

## The review column, what each task waits for

Last checked 2026-11-19.

Waits for you:

- OPS-035 (agents get a signed-in session on the dev app), OPS-029 (a queued job starts a worker in the deployed app), TEST-010 (load test tooling), TEST-020 (showcase seed over every feature), TEST-046 (a ready demo workflow on the dev app), TEST-047 (demo seed with real model results), PROTO-025 (real data on Home, My work and the wizards) and INGEST-032 (every deployed slide has a thumbnail). All of them wait for the reseed of 2026-11-19, after which an agent walks the dev app with its test account. Nothing from you.
- OPS-009 (storage lifecycle and cost controls). The agent token reads account analytics since 2026-11-19, so an agent makes the first live cost report. Nothing from you.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Record input traces on your trackpad at `/spikes/input-traces` in the local dev app, about two minutes.
- VIEW-052 (hidden tab check in headed Chrome). Keep the Mac unlocked and awake for about five minutes while an agent runs the check.

On hold by your answers: OPS-005 (continuous deployment) and SKEL-009 (CI deploys main) by decision 150, OPS-006 (observability) and OPS-007 (alerting) by decision 149, OPS-008 (backups) and SEC-014 (backup restore tests) by decision 152, OPS-014 (production for the first real user) and PILOT-004 (pilot data onboarding) until you have a real pilot sample.
