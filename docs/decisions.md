# Decisions waiting for the owner

Last updated: 2026-11-01

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
| INGEST-017 (publish step and slide status) | Ingest wired to storage, slide status from uploading to ready through a polled status route | Ticked, decisions 9a to 9d |
| AIP-008 (job model and API) | Model run jobs with scope, progress, cancel, resume and retry | Ticked, decisions 8a to 8d |
| SEC-009 (slide label and macro image handling) | Labels and macros served only in clinical projects to owners and viewers, every read audited, deleted with the slide and on patient erasure | Ticked, decisions 10a to 10e |
| RSET-004 (pairing results with slides) | Pairing rules on drop, result uploads paired with a slide or slide upload, import as a result set once the slide is ready, and an override route | Ticked, decisions 11a to 11e |
| AIP-013 (result chunk store) | Versioned cell chunks and a summary index written gzip to object storage under the result set's prefix, and the API reads chunks from there | Ticked, decisions 12a to 12c |
| RSET-011 (cells from imported files) | Imported files write their cells into chunks, inherit cell numbers from older sets and carry each cell's region, and files of only cells import | Ticked, decisions 13a to 13d |
| RSET-012 (large result files in bounded memory) | A 900 MB GeoJSON of 1.6 million cells imports through the real worker in 824 to 1,025 MiB and 42 to 45 s, claimed once, by reading the file in batches into numpy columns | Ticked, decisions 14a to 14c |

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

### 7a. Records accepted under standing approval on 2026-10-17 and 2026-10-18, starting with ADR 0053 (AI results review direction), as listed in item 10 of "Next up" in `docs/README.md`

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

## 9. Publishing uploaded slides, ADR 0122 (the slide row appears only when it is ready)

The ingest job now reads the uploaded file from storage, checks it, writes its previews and level table, and only then creates the slide in its project and case. Until then the upload carries the status, which `GET /api/uploads/{upload_id}/status` answers as uploading, processing, ready or failed.

### 9a. Accept ADR 0122

- A. Accept as written. **Recommended**, because no slide list had to change and a refused file never becomes a slide
- B. Create the slide row when the upload starts, with a status that every slide list filters on
- C. Other

Your choice:

### 9b. A second file with a name the case already has

- A. Keep both, and give the new slide the label "Name (2)", "(3)" and so on, as built. **Recommended** until INGEST-022 (per-file problems in the Check step) lets the person skip a duplicate before uploading
- B. Refuse the upload at its start with a "slide already exists" problem
- C. Fill the existing slide when it has no file yet, as a slide made by a case import has, and number the label otherwise
- D. Other

Your choice:

### 9c. Telling the uploader that a file was refused

The `upload-done` notification says "Your upload has been checked and is ready", so a refused file sends nothing today and only the status route shows the reason.

- A. Add a notification kind "upload refused" with its own line, in-app only, as part of INGEST-018 (ingest failure UX). **Recommended**, because a person who closed the page would otherwise never learn of it
- B. Reuse `upload-done` for both outcomes with a neutral line such as "Parfocal has finished checking your upload."
- C. Keep it on the status route only
- D. Other

Your choice:

Wording, if you pick A or B:

### 9d. Pairing result files with slides in an upload

The upload metadata cannot say that a file is an AI result for a slide, so a GeoJSON or CSV sent through the upload API is refused as not a slide.

- A. Leave it to RSET-004 (pairing results with slides), whose backlog entry now says to add the marker and the import. **Recommended**, because the pairing rules belong there
- B. Add a `result_for` field to the upload metadata now, naming the slide, and import the file in the same job
- C. Other

Your choice:

## 10. Label and macro images, ADR 0124 (labels and macros only for whole-project readers in clinical projects)

A slide's label and macro can show a name or a barcode. `GET /api/slides/{slide}/restricted-images/label` (and `/macro`) now serves them only in clinical projects, to project owners and viewers and to a researcher with open emergency access, and records every read in the audit log. In a de-identified project nobody sees them. They are deleted when the retention purge removes the slide and when a patient is erased. The macro needs the same care as the label, because the NDPI, Leica, Ventana and Argos test slides show the label area in their macro.

### 10a. Accept ADR 0124

- A. Accept as written. **Recommended**, because these are the people who already see the patient's name in the case view
- B. Project owners only
- C. Other

Your choice:

### 10b. Reviewers and labels in a clinical project

- A. A project reviewer never sees the label or macro, even on their own task slides. **Recommended**, because judging AI output does not need the patient's identity and it keeps names with fewer people
- B. A reviewer sees them on the slides of their tasks
- C. Other

Your choice:

### 10c. A switch per clinical project that hides labels from everyone

- A. No switch now. Add it to PROJ-008 (project settings) if a lab asks. **Recommended**, because a lab that wants no labels can use a de-identified project
- B. Add the switch now, off by default
- C. Other

Your choice:

### 10d. Labels in a de-identified project at ingest

Today ingest stores them in every project and the route never serves them in a de-identified one.

- A. SEC-008 (de-identified projects) stops extracting them in a de-identified project, so they are never stored, and a later switch to clinical shows none. **Recommended**, because a de-identified project must never hold a direct identifier
- B. Keep storing them and never serving them, so a switch to clinical shows them
- C. Other

Your choice:

### 10e. The original slide file still holds the label and macro pages

TILES-001 (signed access to slide bytes) will let the viewer read byte ranges of the original. On SVS, NDPI, SCN, BIF and similar files the label and macro are pages of that file, so a reviewer with a tile token could read the label from it.

- A. Ingest records the byte ranges of the label and macro pages, and the edge refuses any range that overlaps them. **Recommended**, because the stored original stays the same bytes as the upload and its SHA-256
- B. Ingest writes a second copy of the original without those pages and serves only that copy, which doubles the storage of every slide
- C. Other

Your choice:

## 11. Pairing result files with slides, ADR 0125 (result files pair in Python and import as their own job)

A dropped result file now pairs with a slide by folder shape, then file name, then the slide ID inside the file, through `POST /api/uploads/pairings`. An upload can be a result file paired with a slide or with a slide upload of the same drop, and it is imported as a result set once that slide is ready. A result that matches no slide waits until its uploader picks one with `PUT /api/uploads/{upload_id}/slide`. This also builds decision 9d (pairing result files with slides in an upload) as its recommended option A.

### 11a. Accept ADR 0125

- A. Accept as written. **Recommended**, because the rules live in one place next to the readers and a waiting result never needs a paused job
- B. Run the rules in the browser in a TypeScript package, with the API only listing the slides already in the case
- C. Other

Your choice:

### 11b. Who may place a result that waits for a slide

- A. Only the person who uploaded it, like every other upload route since INGEST-001 (upload API with presigned multipart), as built. **Recommended** until INGEST-021 (upload wizard with slides and results) shows waiting results to anyone but their uploader
- B. Every owner of the project too, so a result is not stuck when its uploader leaves
- C. Other

Your choice:

### 11c. Cells in imported result files

Writing cells needs the chunk store of AIP-013 (result chunk store), which is not built. RSET-011 (cells from imported files) is the new task that adds them.

- A. Import a file's regions and zones now, keep the file, say on the status that its cells were not imported, and refuse a file that holds only cells, as built. **Recommended**, because results with regions are useful today and the kept file can be imported again later
- B. Keep every file with cells waiting until RSET-011 (cells from imported files) lands
- C. Other

Your choice:

Built since: RSET-011 (cells from imported files) landed on 2026-11-01, so a file's cells are now imported with its regions, a file of only cells imports, and the `cells-not-imported` notice is gone. Sets imported before it keep no cells, and uploading their file again adds them as a new set. Your letter here now only records how files were handled until then.

### 11d. Which pairings count as likely rather than sure

- A. Sure for the same name next to the slide, a folder named like the slide, the same name anywhere and a Parfocal slide ID inside the file. Likely for a name that only starts with the slide's name, such as `tumor_031_prob` for `tumor_031`, and for a slide file name inside the file, as built. **Recommended**, because only the mock's "Similar name only" case carries a warning
- B. Make the slide file name inside the file sure as well
- C. Other

Your choice:

### 11e. Masks and heatmaps in the upload

A PNG or TIFF mask needs its slide level and scale before it can be read, which RSET-005 (import checks and fixes) asks for.

- A. Refuse a mask or heatmap as a result upload until RSET-005 (import checks and fixes), as built. **Recommended**, because the person learns it at once instead of after the upload
- B. Accept it and keep it waiting until RSET-005 (import checks and fixes) can import it
- C. Other

Your choice:

## 12. Cell chunks in object storage, ADR 0126 (cell chunks in object storage with a summary index)

`parfocal_common.chunk_store` writes a result set's cells as gzip chunks per 2048 pixel tile and one summary file under `t/{tenant}/s/{slide}/results/{set}/`, and the API now reads chunks from object storage for review order and cell scopes. The summary header lists every chunk with its tile, counts and class counts, so no migration was needed. Version 1 of the chunk schema grows only by optional fields, and a reader refuses a version it does not know.

### 12a. Accept ADR 0126

- A. Accept as written. **Recommended**, because the viewer gets the chunk index with the first file it fetches and the database keeps only what its queries use
- B. Also store the number range and class counts per chunk as columns of `result_chunks` in a migration, so SQL can pick chunks by class
- C. Other

Your choice:

### 12b. Type probabilities in the summary file

The summary file is the whole-slide overview that AINUC-004 (summary points API) serves. With five classes, probabilities add 5 bytes to each 21-byte row, and that task's budget is 25 MB for 1.6 million cells, which nobody has measured yet.

- A. Write `probs` into the summary whenever the chunks have them, as built. **Recommended**, because AINUC-004 lists them and confidence colours on the overview need them without fetching every chunk
- B. Keep them only in the chunks, so the overview is smaller and the viewer fetches chunks for confidence
- C. Other

Your choice:

### 12c. What an alternative type is

The backlog asks for alternative types in each chunk. The POC stored one per cell, the class a second typer gave (POC doc 29, a better typer and second opinions).

- A. One `alt_class` per cell, the class a second model gave, with none when there is no second model, as built. **Recommended**, because it keeps the second opinion even when an import has no probabilities
- B. No stored field, and take the second most likely class from the probabilities
- C. Other

Your choice:

## 13. Cells from imported files, ADR 0127 (imported cells keep their numbers by centre distance and take the innermost region)

An imported GeoJSON, QuPath export, Parfocal JSON or CSV now writes its cells into chunks in object storage. A cell inherits the number of an older set's cell whose centre is within 4 µm (16 pixels on a slide without a pixel size), read from the older sets' summary files, and new cells get the next numbers in reading order. A second import of the same QuPath 0.7 export keeps every number. Each cell carries the region of its own set that its centre lies in.

### 13a. Accept ADR 0127

- A. Accept as written. **Recommended**, because it reuses the ADR 0071 (object ID grammar) rule and matched 1.6 million cells in under two seconds
- B. Match cells by outline overlap, as regions are matched
- C. Other

Your choice:

### 13b. A cell whose centre lies inside two overlapping regions

- A. It takes the smaller region, and the lower number when both are the same size, as built. **Recommended**, because a nested region such as a tumour nest is the more specific place
- B. It takes the larger region, which is the lower number
- C. It takes the region the file names as its parent when there is one, and the smaller region otherwise
- D. Other

Your choice:

### 13c. Cells with no score in the file

QuPath exports carry no detection score, and the chunk format has no way to mark one as missing.

- A. Store score 0, so a "cells below a score" task takes every unscored cell, as built. **Recommended** until a set can say it has no scores, because a reviewer then sees every unscored cell instead of none
- B. Store score 255, so such a task takes none of them
- C. Refuse a "cells below a score" task on a set without scores, which needs an optional marker in the summary header and a small follow-up
- D. Other

Your choice:

### 13d. Probabilities on only some cells of a file

- A. Keep none and show the notice `cell-probabilities-dropped` on the upload status, as built. **Recommended**, because the chunk format holds probabilities for all cells of a set or for none
- B. Refuse the file
- C. Other

Your choice:

## 14. Large result files, ADR 0128 (result files stream through a byte scanner into cell columns)

The import no longer decodes a result file as one tree. A byte scanner finds the features of a GeoJSON or the objects of a Parfocal JSON in 1 MiB blocks and msgspec decodes them in batches, a CSV is read in batches of rows, cells are kept as numpy columns in files in the job's work folder, and the worker writes the chunks from those columns. In seven imports of the 900 MB synthetic file of 1,607,244 cells through `python -m parfocal_ingest` against MinIO, the worker peaked at 824 to 1,025 MiB of resident memory, the step took 42 to 45 s, the job was claimed once with a second worker waiting, and the lease never had less than 40 s of its 60 s left. RSET-011 (cells from imported files) needed about 6 GiB and two minutes for the same file. The numbers are from a MacBook Air M4, not from Modal.

### 14a. Memory of the Modal ingest container

Modal bills memory at $0.00000222 per GiB per second for the larger of what a function requests and what it uses, and kills a container that passes its hard limit. For a 47 s import that is $0.00010 at 1 GiB, $0.00021 at 2 GiB and $0.00042 at 4 GiB, so the difference between 2 and 4 GiB is $0.00021 per import, about $0.21 for 1,000 imports. CPU is billed on top and does not depend on this choice. The time on Modal is TODO until the benchmark runs there.

- A. Request 2 GiB with a 2 GiB hard limit, as `INGEST_MEMORY_MIB = 2048`, and the benchmark fails when a run passes it. **Recommended**, because the measured peak is about half of it and it is the cheapest size that leaves that headroom
- B. Request 2 GiB with a 4 GiB hard limit, which costs the same as A until a file needs more than 2 GiB, and keeps a larger slide or a QuPath export with nucleus outlines from being killed
- C. Request and limit 4 GiB
- D. Other, write the number below

Your choice:

Number:

### 14b. Accept ADR 0128

- A. Accept as written: a byte scanner of this project's own with msgspec, and cell columns spilled to the work folder. **Recommended**, because it adds no dependency, msgspec still checks every byte, and its tests compare it with a whole-file decode at block sizes down to one byte
- B. Use ijson with its C backend for the batches, a new dependency that measured 0.53 s against the scanner's 0.57 s on 52 MB
- C. Other

Your choice:

### 14c. Two writers of the chunk format

py-common has no numpy, so `build_cells` in `parfocal_common.chunk_store` stays for the API and its tests, and the ingest worker writes imported cells with its own columnar writer, `parfocal_ingest.chunk_builder`. A test checks that both write the same bytes.

- A. Keep both writers, held together by the byte-identity test. **Recommended**, because the API image stays without numpy and the API tests that build chunks stay as they are
- B. Give py-common numpy and keep only the columnar writer
- C. Other

Your choice:

## 15. Your review of the ported prototype, ADR 0129 (the prototype moves into React and becomes the design source)

The port starts when the round 6 redesign has finished all its batches. The setup that does not depend on the design is being built now. Every PROTO screen task stays in review until you have looked at it, whichever option you pick here.

### 15a. Your review of each ported screen group

- A. You compare each screen group with the frozen mock in the running dev build before its task is ticked. **Recommended**, because the design is yours and differences are cheapest to fix one group at a time
- B. The agent compares its screenshots with screenshots of the frozen mock, and you look at everything once at the end
- C. Other

Your choice:

## Notes, no decision needed

- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
