# Decisions waiting for the owner

Last updated: 2026-10-31

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What landed today

| Task | What it is | State |
|---|---|---|
| IAM-024 (admin as a right of a researcher) | `admin` is now a flag on a researcher, per ADR 0096 | Ticked |
| STACK-039 (resumable upload protocol) | ADR 0116 (S3 multipart with Uppy) accepted, spike against MinIO | Ticked |
| GUIDE-012 (least sure first order) | Each reviewer's regions and cells come least certain first | Ticked, decisions 1a to 1c |
| TASK-004 (blinding and first read) | Reviewers are blind until they submit, the AI can stay hidden for a first read | Ticked, decisions 2a to 2c |
| NOTIF-007 (inbox API) | Inbox list, read state, mutes that keep muted items | Ticked, decisions 3a and 3b |
| EVAL-007 (study template model and API) | Versioned study templates from report blocks, five built-ins | Ticked, decisions 4a to 4d |
| INGEST-001 (upload API with presigned multipart) | Upload routes for ADR 0116, tested against MinIO | Built, the tick waits for decision 6a, decisions 5a to 5d |
| INGEST-017 (publish step and slide status) | Ingest wired to storage, slide status from uploading to ready | Agent running |
| AIP-008 (job model and API) | Model run jobs with scope, progress, cancel, resume and retry | Built, merging, decisions 8a to 8d |

## 1. Least sure first order, ADR 0117 (review order stored per task slide)

The order is computed when the task is made, after the task's scope is applied, and stored as one packed list per task slide. A later recalibration cannot reshuffle a running review.

### 1a. Accept ADR 0117

- A. Accept as written. **Recommended**
- B. Store only a seed and the calibration in use, and compute the order on every read
- C. Other

Your choice:

### 1b. Cells that have no class probability (imported chunks without `probs`)

- A. Count them as unscored, after all scored objects, in the task's fixed random order. **Recommended**, because the chunk format cannot mark a score as missing and a fallback would mix two kinds of numbers in one order
- B. Fall back to the detection score for them
- C. Other

Your choice:

### 1c. What "inside a region of interest" means for a task scope

- A. A region counts when it touches a region of interest, a cell counts when its centre lies inside, and any author's region of interest counts. **Recommended**
- B. A region must lie fully inside
- C. Only regions of interest drawn by the task owner count
- D. Other

Your choice:

## 2. Blinding and first read, ADR 0118 (blinding and a kept first read)

A reviewer sees other reviewers' verdicts, opinions and added objects only after submitting the slide. With the first read switched on, the reviewer sees no AI output until they record a first read, which is kept unchanged, so a reader study gets both the unaided and the aided read.

### 2a. What the first read hides

- A. All AI output: objects, classes, scores and counts, as built. **Recommended**, and first reads collected this way stay valid if you move to B later
- B. Only the AI's class and confidence. Outlines and IDs stay visible and the reviewer picks each object's class blind, as POC doc 44 (round 6 working mock) draws it. This adds a new GUIDE task for the blind class picks
- C. Other

Your choice:

### 2b. Reopening a blinded slide after seeing the others' work

- A. Allowed until sign-off, with every change in the audit log, as ADR 0080 (disagreement rule and sign-off) already allows. **Recommended**, because the disagreement queue needs reviewers to fix mistakes
- B. Locked once submitted in a blinded task
- C. Allowed, but the first submitted review is kept as well, for comparison
- D. Other

Your choice:

### 2c. The default opinion form asks "Is the AI result acceptable for this slide?", which makes no sense during a first read without the AI

- A. Let a form mark which questions belong to the first read, as a follow-up in GUIDE-006 (opinion form builder). **Recommended**
- B. Skip the opinion form in the first read and ask it only after the AI is shown
- C. Other

Your choice:

Wording for a first read question, if you want one:

## 3. Inbox mutes, ADR 0119 (inbox mutes)

A person mutes a project, a review task or a case. Muted notifications stay in the inbox under a "muted" filter, but never push, email or join a digest, and the bell's badge leaves them out. Mentions, emergency access, task assigned and task due soon always get through. Every catalogue kind must declare whether it breaks through.

### 3a. Accept ADR 0119

- A. Accept as reworked today. **Recommended**
- B. Mute cases only, as the backlog first said
- C. Other

Your choice:

### 3b. Should "disagreements ready" get through a mute

- A. Yes. **Recommended**, because only the project owner can resolve disagreements, and a muted owner would otherwise not be told
- B. No, keep it silenced like other updates
- C. Other

Your choice:

## 4. Study templates, ADR 0120 (study templates as workspace rows that a task only pins)

A study template has a name, a kind, ordered report blocks from a closed catalogue of 11 kinds, page format settings and task presets. Templates are versioned per workspace, and the five built-ins (detection, segmentation, cell typing, reader study, sentinel node AI evaluation) are seeded in every workspace. Only researchers with admin rights create, edit, retire and restore them. A task records the version it pins.

### 4a. Accept ADR 0120

- A. Accept as written. **Recommended**
- B. Keep the built-ins in code shared by every workspace, and store only custom templates as rows
- C. Other

Your choice:

### 4b. One task checking several kinds of object at once, such as all regions plus a cell sample, as the mock's sentinel node template shows

- A. Yes, as a later task that turns a task's scope into a list. **Recommended**, because sentinel node and cell typing studies both want it
- B. No. Make a separate task for each kind
- C. Other

Your choice:

### 4c. Questions in the "Reader study form" and the "Outline quality form" that the mock names but never defines

- A. Keep using the project's current form until you write them. **Recommended**
- B. I draft both forms from the POC and the mock for you to review
- C. Other, write the questions below

Your choice:

Questions:

### 4d. Cell typing template sample size

- A. Keep 200 cells. **Recommended**
- B. Another number, write it below

Your choice:

Number:

## 5. Upload API, ADR 0121 (S3 client signed by hand on httpx2)

The API creates uploads, signs one 16 MiB part URL at a time for 15 minutes, lists parts, refuses uneven or missing parts, aborts, and finds a reloaded page's open upload. A completion queues the ingest job.

### 5a. Accept ADR 0121

- A. Sign S3 requests by hand on the HTTP client the API already uses. **Recommended**. It is 309 lines in `parfocal_common.object_store`, matches two AWS-published example signatures and is checked against MinIO in every test run
- B. Use aiobotocore, which brings aiohttp and a pinned botocore
- C. Use boto3 in a thread pool
- D. Other

Your choice:

### 5b. Largest upload

- A. 20 GiB. **Recommended**, the largest fixture is about 7 GB
- B. Another size, write it below

Your choice:

### 5c. Who may upload slides

- A. Only project owners. **Recommended**
- B. Project owners and reviewers on the project
- C. Other

Your choice:

### 5d. R2 rule that aborts unfinished uploads after one day

- A. Apply it to all of `t/`, because R2 prefixes cannot skip the tenant segment in `t/{tenant}/quarantine/`. It touches only unfinished multipart uploads, never stored files. **Recommended**
- B. Rely only on the API's own job, which aborts uploads with no activity for 24 hours
- C. Other

Your choice:

## 6. Real infrastructure

### 6a. `tofu apply` on the R2 dev bucket `parfocal-dev` for INGEST-028 (upload protocol check on R2)

It sets the bucket's CORS rule and the unfinished-upload rule, then reruns the upload spike at 1 GiB under a prefix that is deleted afterwards. The expected cost is $0 within R2's free tier. INGEST-001 (upload API) cannot be ticked before it.

- A. Yes, show me the exact plan diff first and apply after my second yes. **Recommended**
- B. Not now
- C. Other

Your choice:

### 6b. Neon project `neon-red-engine`, created on 2026-10-31 at 11:20 UTC by someone other than an agent session

- A. It is mine, leave it alone
- B. I don't know it. Tell me what is in it, read-only
- C. Other

No recommendation, this needs your answer.

Your choice:

## 7. Older items

### 7a. Records accepted under standing approval on 2026-10-17 and 2026-10-18, starting with ADR 0053 (AI results review direction), as listed in item 8 of "Next up" in `docs/README.md`

- A. I'll read them when I have time. **Recommended**
- B. Send me a one-page summary of them first
- C. Other

Your choice:

### 7b. FOUND-014 (dependency and licence scanning), on hold since 2026-10-15

- A. Keep it on hold. **Recommended**
- B. Start it
- C. Other

Your choice:

## 8. Model run jobs, ADR 0123 (model runs as engine jobs per slide)

A model run is one job per slide in the shared job engine, with a `model_runs` record for the slide, an optional review task, a batch shared by slides started together, the scope (a view rectangle, a selection or the whole slide), the detector and typer as name and version, 1 or 8 test-time views, and raster or tumor-first tile order. Each slide has six stages with progress counted in units. Start, cancel, resume and retry are audited. No GPU work runs yet.

### 8a. Accept ADR 0123

- A. Accept as written. **Recommended**, because result sets and the run notifications already point at engine jobs
- B. A separate table and runner for model runs, outside the job engine
- C. Other

Your choice:

### 8b. What resume does after a cancel

- A. A cancelled run can be resumed, which is the "Undo" after a cancel, and it keeps its finished tiles. **Recommended**
- B. A cancelled run is final, and the person starts a new run
- C. Other

Your choice:

### 8c. Who sees model runs

- A. Project owners and viewers see every run. A reviewer sees only runs on their own task slides, and none while their first read on that slide is open. **Recommended**
- B. Only project owners and viewers see runs
- C. Everyone in the project sees every run
- D. Other

Your choice:

### 8d. A limit on how many times a failing job is claimed again

- A. Add a cap of 3 claims per job, after which it fails for good and the person retries by hand, as a small follow-up. **Recommended**, because a job that crashes its worker would otherwise loop
- B. No cap
- C. Another number, write it below

Your choice:

Number:

## Notes, no decision needed

- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads) and `0046` (model runs), and INGEST-017 (publish step) takes `0047`.
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
