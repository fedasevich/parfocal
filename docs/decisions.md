# Decisions waiting for the owner

Last updated: 2026-11-02

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What your answers of 2026-11-02 changed

| Answer | What changed |
|---|---|
| 10b, reviewers see labels on their task slides | `see-labels` is now "In their tasks" for a project reviewer, and ADR 0124 (labels and macros) says so |
| 5b, largest upload | 100 GiB, which is 6,400 parts of 16 MiB |
| 14a, ingest memory | The worker requests 2 GiB with a 4 GiB hard limit |
| 4d, cell sample size | Already a setting: 200 is only the template's preset, and a task takes any count from 1 to 10,000 |
| 4a, built-ins | The five built-ins stay defined in code and seeded into every workspace, so they come from one place and a workspace can still add its own |
| 7a, summary of older records | [One page](project/standing-approval-records.md) for ADR 0054 to ADR 0091 |
| 3a, mutes | Kept as built, because muted notifications still show in the inbox. ADR 0119 (inbox mutes) is accepted, and disagreements ready gets through a mute |
| 4c, the two forms | The reader study and segmentation built-ins carry the Reader study form and the Outline quality form as drafted |
| 6c, test slides | They go once into `parfocal-dev`, and production and CI read them there with a read-only key |
| Follow-ups | New tasks for a cap of 3 claims per job, first read questions, a task scope as a list, the two missing forms and the shared test slides bucket |

Every other answer took the recommended option, and ADR 0117 (review order), 0118 (blinding), 0120 (study templates), 0121 (S3 client), 0122 (slide row when ready), 0123 (model runs), 0124 (labels), 0125 (result pairing), 0126 (cell chunks), 0127 (imported cell numbers) and 0128 (streamed result files) are accepted. The blank 12a, 13b and 14b took the recommended option.

## 6. Real infrastructure

### 6a. `tofu apply` on the R2 dev bucket `parfocal-dev` for INGEST-028 (upload protocol check on R2)

You wrote yes here. The rules count only a yes in chat for the exact plan, so the plan diff and its cost will be shown in chat first and applied after your yes there.

## 16. Names inside slide files, SEC-028 (identifying text in de-identified originals)

### 16a. How a de-identified project keeps a slide file's own text out of reach

PROJ-002 (privacy modes) asked that an upload arrives without the names in its file metadata, such as the `Filename` field of an SVS ImageDescription. Parfocal stores nothing from that text, but the viewer will read the original file by byte ranges through TILES-001 (signed access to slide bytes), and you chose in 10e that the stored original keeps the bytes and SHA-256 of the upload.

- A. Ingest records the byte ranges of the identifying text tags, and in a de-identified project the edge serves those ranges with the text replaced by spaces of the same length. **Recommended**, because it matches 10e, the stored file stays as uploaded, and the viewer still finds every tag it needs, such as the pixel size, which sits outside the blanked fields
- B. Ingest writes a cleaned copy of the original for de-identified projects and serves only that, which doubles the storage of those slides
- C. Refuse an upload to a de-identified project when its metadata holds a name-like field
- D. Other

Your choice:

## 17. Slide files

### 17a. Barcodes in file headers

TILES-001 (signed access to slide bytes) closes the label and macro pages of the original, but the Leica SCN header, an XML block in the first IFD that every viewer must read, holds the slide barcode (`<barcode>` in `Leica-1.scn`). A task reviewer who may not see labels could read it through the tile path. ADR 0137 (capability tokens for slide bytes) records the gap.

- a. (recommended) Ingest also closes header fields that hold a barcode, and the viewer reads the slide's geometry from `levels.json` instead of the file header for those formats. Needs a small reader change in SKEL-006 (open the slide in Viv).
- b. Leave it, because the barcode is an accession code without a name, and add it to ADR 0124 (labels and macros) as a known gap.
- c. Serve SCN slides only to whole-project readers until a or b.

Your choice:

## 18. Site validation sets

MLEVAL-008 (site validation reports) records a report from a model's scores and the known outcome of each case in the site's local validation set, sent with the request, because no paid model run is allowed yet. The report counts true and false positives and negatives at a threshold, gives sensitivity and specificity with 95% Wilson intervals, and posts a model announcement to every member's home feed.

- a. (recommended) Keep it this way, so a site or a pipeline sends the scores and outcomes it already has, and AIP-005 (validation mapping per site and specimen) reads the stored reports.
- b. Derive the validation set from the workspace's own reviewed cases, with the truth from reviewers' decisions and the scores from a model run on those slides, which needs a model run queued on real compute.
- c. Both, with b added once model runs execute on GPUs.

Your choice:

## 19. Decision styles, from GUIDE-015 (decision styles with the raw answer and Counts as)

### 19a. Reasons on a decision whose Counts as value changes

When the task owner edits Counts as after answers exist, an answer can move from disagree to not sure or to agree, and its disagree reasons no longer fit.

- a. Drop the reasons that no longer fit, undo a Wrong class retype, and log how many were dropped. (recommended, built)
- b. Keep every reason and let the report show reasons that do not match the counted value.
- c. Refuse a Counts as change that would drop a reason.

Your choice:

### 19b. Yes or no when the question names another class than the AI's

Yes counts as agree and No as disagree on every AI object, which reads the AI's claim as always positive. A template question such as "Is this tumor?" on an object the AI called stroma would then count the wrong way.

- a. Keep it as built, with the question as plain text. (recommended for now)
- b. Let the task name the class its question asks about, so Yes counts as agree only on objects the AI called that class.

Your choice:

### 19c. The style of a hidden first read

ADR 0131 (decision styles, raw answers and submit gating) leaves open whether a task that hides the AI for a first read switches to Pick the class blind in the API or only on screen.

- a. Only the screen switches, and the API refuses a style that shows the claim with a hidden first read once the New review task warning is built. (recommended)
- b. The API stores the first read in Pick the class blind and the second read in the task's own style.

Your choice:

## 20. Sample project, from ONB-005 (sample project)

### 20a. What two result sets means

The sample seeds two result sets on every one of its four slides, one from the CAMELYON tumor model and one from PathoSAM + HoVer-NeXt, so the same slides can be compared side by side as EVAL-004 (compare two evaluations) plans. The setup screen says "4 slides, 2 result sets".

- a. Two models, each with a set on every slide, eight sets in all. (recommended, built)
- b. Two result sets in total, on two of the four slides, and the review task covers only those two.

Your choice:

### 20b. Who may delete a project

- a. Only the sample can be deleted, by its owner. Real projects are archived. (recommended, built)
- b. Any owner may delete any project, behind a typed confirmation.

Your choice:

### 20c. Who may add the sample

- a. Anyone who may create projects, so researchers and admins. A reviewer who picks the sample in setup gets nothing until ONB-004 (first-run setup) decides. (built)
- b. Every member, so a reviewer can try a review on the sample too, as setup recommends for that role.

Your choice:

## 21. Questions from the parallel backend tasks of 2026-11-02

### 21a. Case numbers in file names, from CASES-024 (sorting dropped files into cases)

A dropped slide gets its case from its folder or from a file name that starts with a case number. A case number is matched as letters, up to four digits, a dash and digits, such as `S26-04812`, so TCGA-style names stay loose.

- a. Keep this rule. (recommended, built)
- b. Make the pattern a project setting.
- c. Also take the part of any name before `_` as the case.

Your choice:

### 21b. Missing scores in an imported result file, from RSET-005 (import checks and fixes)

When rows of a result file have no score, the uploader chooses what they count as, and "no score" is preselected. The open question is the default.

- a. No score. (recommended, built, because it invents no numbers)
- b. 1.0.
- c. Always ask, with nothing preselected.

Your choice:

### 21c. Decisions of a reviewer whose slides were reassigned, from TASK-007 (nudge, reassign and change a task)

Reassigning "every slide" keeps the first reviewer's decisions under their name on slides they had started, so such a slide then holds both reviewers' decisions. ADR 0142 (a reassign releases started assignments) records how.

- a. Keep counting the released reviewer's decisions in the evaluation. (recommended, built, because the work stays under their name)
- b. Leave released reviewers out of the evaluation.
- c. Count them only when they had submitted the slide.

Your choice:

### 21d. Tumor maps for the CAMELYON16 test slides, from AITUM-003 (areas from the tumor map)

The area code matches the POC on tumor_009, a training slide, with 7 areas and 8.05 mm against 8.06 mm. The test slides are in the dev bucket, but none has a tumor map, and making them needs a paid GPU run. The task is in review until then.

- a. Make the maps on Modal dev with a cost cap when MLEVAL-005 (tumor map evaluation) runs, and evaluate both tasks then. (recommended)
- b. Run them now just for AITUM-003.
- c. Accept the tumor_009 check and tick AITUM-003.

Your choice:

### 21e. Pushes to main skip the required `ci-ok` check

Agent pushes to `main` print "Required status check ci-ok is expected" and still land, so the ruleset lets this account bypass CI. Agents run `pnpm -s verify` before each push, but nothing stops a red commit, and one SET-001 (settings storage) commit did land red today and was fixed within the hour.

- a. Keep the bypass, because agents push directly and verify locally. (recommended for now)
- b. Remove the bypass so agents push to task branches and merge through pull requests once CI passes. This changes a GitHub ruleset, which you do yourself.

Your choice:

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
