# Result: deployed walk of the review tasks on v0.46.0

- Date: 2026-11-23
- Backlog: PROTO-104 (a search hit opens its page and moves the camera to the object), PROTO-159 (round six slips after the v0.35.12 walk), PROTO-166 (a preparing review answers a waiting state), PROTO-073 (guided steps and Smart select stay in sensible bounds), PROTO-157 (round five small slips), EXP-014 (the study runs for the participant in one tab), EXP-016 (each study participant starts from the same fresh seeded project), OPS-038 (a GPU wait shows the wait, not an error), PROTO-135 (Best answers or says why it cannot), PROTO-145 (whole slide cell detection starts, and a review shows only its own runs)
- Kind: deployed check
- Commit: ea87be4 (v0.46.0), named by /api/status after deploy run 45269848987 finished with success
- Environment: app.parfocal.eu (a development environment by ADR 0390), headless Chromium 1248 through Playwright 1.65 at 1440 by 900, Apple M4
- Data: the seeded demo workspace cvut-biomedical, the accounts agent-walk and role-researcher, no PHI

## Question

Does each task waiting in review meet its "Done when" line on the deployed app?

## Method

Sessions came from `scripts/agent_session.py` (agent-walk) and `--role researcher`. Scratch Playwright scripts opened one headless browser at a time with the saved storage state and read the camera from the `data-camera` attribute of `slide-host` (x, y in slide pixels and a log2 scale where 0 is the scan's native pixel). The target of a cell came from `data-picked-centre` of `result-set-cells`, of an AI region from `/api/slides/{id}/areas` and of a drawn shape from the centre of its bounding box in `/api/slides/{id}/annotations`. API reads used the session cookie, and writes went through `fetch` inside the page, because the API refuses writes from another origin (403 cross-origin-write). No screenshot was taken and no code was changed.

What the walk left in the dev app: RT-11 "Walk preparing check" by role-researcher on Philips-3.tiff (30 random cells, all decided, submitted, now in the disagreement queue because C66 got a 2), RT-12 "Walk guided scan power check" by agent-walk on CMU-1-Small-Region.svs and Huron-1-40x.tif (3 random cells each, untouched), one Best outline proposal that was not saved, and a whole slide run on synthetic-zlib.ome.tiff in P03. There is no delete route for a review task, so the next reseed removes them.

GPU calls made: 2, one Best embedding of a view and one whole slide model run.

## Results

### PROTO-104, search hits move the camera. Passes without a task, fails for some hits inside a task

| From | Hit | URL after the pick | Camera minus target (px) | Scale | Picked |
|---|---|---|---|---|---|
| Search page | C1 on Philips-3.tiff (AI cell) | `?object=C1` | 0 | 4.00 | cell `671c3749…:1` |
| Search page | T2 on Argos-1.avs (AI region) | `?object=T2` | 0.21 | -0.28 | not observable |
| Search page | T7+ on Philips-3.tiff (drawn) | `?object=T7%2B` | 0.16 | 1.73 | select layer `1` |
| Palette from home | the same three | the same | 0.01, 0, 0 | 3.53, -0.19, 4.00 | cell, not observable, `1` |
| Palette from another slide (CMU-1-Small-Region.svs) | the same three | the same | 0, 0, 0 | 3.64, -0.19, 3.99 | cell, not observable, `1` |
| Palette inside RT-7 Annotation example on Philips-3.tiff | C1, the hit carries the task | `?task=…&object=C1` | 0 | -6.97, the whole slide fit, unchanged | no picked cell, the select layer has none |
| Palette inside RT-4 Every outcome review on Case outcomes 1 | T1, the hit carries the task | `?task=…&object=T1` | 0 | -0.003 | not observable |
| Palette inside the Drawn outline review example on Case drawn outlines | T1+, the hit carries the task | `?task=…&object=T1%2B` | 70,167, the camera stayed at the whole slide fit (65273, 28720) | -6.96 | none |

Opening the two failing task URLs directly in a fresh page gave the same camera. The same drawn URL without the task centred on (900, 800) at scale -1.22 and picked it. No search hit in the seed has an ID like T2.C145: `/api/search?q=T2.C145` and `T2·C145` gave 0 hits, so that risk could not be walked. No API call answered 400 or more. One console error showed once, "result set cells did not page in AbortError".

### PROTO-159, round six slips. Passes on what was walked

- Decisions CSV names cell classes. Pass on fresh files. For RT-11 a fresh `decisions.csv` had 30 rows, Immune 26 and Stroma 4, and `objects.csv` the same classes. But the plain URL served a stale copy, see new issue 1. The evaluation JSON of the same task lists its cells under one class, "unclassified", so the report screen may still say that, not checked further.
- Top bar Upload stays in the project. Pass. On `/projects/{P03}/upload` the one Upload button of the banner kept the URL at P03's upload page, not the first project.
- A slide outside a task. Pass for both kinds. Argos-1.avs with `?task=` RT-7 (annotate) and a P01 slide with `?task=` Every outcome review both showed "This slide is not part of the task", "You can open the task, or look at the slide on its own. Nothing was changed." and "Open the task", with no API answer of 400 or more and no console error.
- Guided review field and coach bubble. Pass. RT-12's guided view opened a cell at scale -0.003 on the 20x slide and -0.32 on the 40x slide, never above native. Coach tip 1 sat at x 16, y 80 (300 by 46), away from the canvas centre at (486, 482), and none of the four tips covered it.
- One Best click makes one GPU call. Pass, one POST to `/embeddings/view`, see PROTO-073.
- The run notice names the model. Pass, the job reads "PathoSAM + HoVer-NeXt v1.2".

### PROTO-166, preparing state and true counts. Passes on what could be walked

| Seconds after opening RT-11 | /objects status | order | ready_in_seconds | objects |
|---|---|---|---|---|
| 3.0 | 200 | preparing | 28 | 0 |
| 6.3 | 200 | preparing | 25 | 0 |
| 9.5 | 200 | preparing | 22 | 0 |
| 12.9 | 200 | preparing | 19 | 0 |
| 16.3 | 200 | preparing | 15 | 0 |
| 20.0 | 200 | ready | | 30 |

No 409 and no console error. The page read "The objects of this slide are still being put in review order. They appear here on their own once it is ready." The P03 header read "2 of 15 slides reviewed", then "3 of 15 slides reviewed" after RT-11 was submitted. The new run job reports `unit: tile`, but its count could not be judged because the run never started, see PROTO-145. The import job state was not checked, because no import was cheap to make.

### PROTO-073, guided steps and the Best wait. Partly checked

- Guided steps stop at the scan power. Pass on CMU-1-Small-Region.svs (20x, scale -0.003) and Huron-1-40x.tif (scale -0.32).
- Best ends its wait within 90 s. Not reached, because Best answered. One click with Best on CMU-1-Small-Region.svs: "Waiting for a GPU" with a seconds count and Cancel showed from 9 s to 26 s, the embedding POST answered 200 at 26.0 s, the chip read "Outlining" with no wait shown from 28 s to 63.7 s, then "Outline found", and the layer was ready with encoder `server` and 1 proposal at 65.1 s. No console error.

### PROTO-157, round five slips. Passes on what was walked

- Devices in words. Pass. Privacy and session read "1 other devices are signed in: an unnamed client." (the agent's API session). The count is not made singular.
- One version in the Display tab. Pass. Each result set shows its name and one version line, such as "Tumour detector v1" with "MONAI tumour detection 0.6.4, ONNX" and "Cell typer v1" with "InstanSeg v0.1.1, HoVer-NeXt PanNuke typer".
- Cells pill pressed state. Pass for the pressed side. In RT-12 the pill "Cells 0 of 3" had aria-pressed true on a cell. The unpressed side needs a task with regions and cells, which the seed has not got in agent-walk's work.
- The stale 1,418 objects after a run was not walked, because the run never finished.

### EXP-014, the study page. Partly checked, blocked at the first task

- Consent. Pass. `/study` reads "We test the app, not you", "11 short tasks", "Think aloud", "This tab is recorded" (screen, mouse, clicks and keys, no camera or microphone) and "You stay anonymous" with a code, then "I agree and start".
- The code is made by the page (P-47MG, P-B3DH and P-4BRX on three loads). There is no field to type DRY-1.
- Tasks. Blocked. Task 1 of 11 ("Find the slide that is waiting for your review in this project and open it.") keeps Start task disabled for over 20 s with no reason shown, because no participant project "Study CODE" exists. The page calls `GET /api/projects//review-tasks` with an empty project ID, which answers 404 and logs a console error. On the first load two "Failed to load module script" console errors also showed, which did not come back on three later loads. So consent to SEQ, notes and give-up were not walked.
- Final block. Pass, reached by setting the tab's run state to the final phase, not by finishing the tasks. Ten SUS statements with round 4's wording on one page with no Back, then like, dislike, "Was there anything you expected to find but could not?" and recommend, each with Back and Next, then "Thank you!". Back from the like page to the SUS page changed statement 1 from 4 to 1. The stored session held `sus` [1, 4, 4, 4, 4, 4, 4, 4, 4, 4], `susScore` 42.5 (right for those answers), the four open answers and a change log entry `{key: sus1, from: 4, to: 1}`.

### EXP-016, participant seed time. Not measured

`python -m parfocal_deploy.study seed DRY1 --seat agent-walk@parfocal.eu` failed before it touched anything: the Neon key in `~/.config/parfocal/neon.env` is scoped to the deleted US project soft-pine-86468744, while the production variable NEON_PROJECT_ID names the Frankfurt project, so the branch lookup answered 404. No workflow runs the study seed, so it is not a single command from the Mac today.

### OPS-038, PROTO-135 and PROTO-145

- OPS-038. Pass for the screen part. The Best call showed "Waiting for a GPU", a running seconds count and Cancel, and ended in a result with no error. The cold pool smoke and the week of wait logs were not checked.
- PROTO-135. Pass for the warm-enough case. Best showed the wait and then a proposal, 65 s from click to proposal, of which the server answered at 26 s. A truly cold time was not measured.
- PROTO-145. Fails on the start time, passes on the finish. The Run a model dialog on P03 picked "PathoSAM + HoVer-NeXt" for synthetic-zlib.ome.tiff and promised "About 2 min". The POST answered 201 at 22:09:37 UTC. `/api/me/jobs` then read queued, 0 units, until between 22:27:52 and 22:28:06, so about 18.5 minutes, then running 1 of 2 tiles at 22:28:22 and done 2 of 2 tiles at 22:28:35, unit tile and percent 100. So the run itself took about 30 s, and the tile count (2 of 2) is a plain one. While it was queued, Modal main showed parfocal-gpu-pool with 1 task. The GPU cost is not known yet (TODO). "A review lists only its own runs" was not walked. The new result set was not read, because the agent-walk session's active workspace had moved to cvut-imaging by then, likely from another agent on the same account, and switching back needs a write from the app.

### The queued model run in detail

The run 7e791c6e is the walk's run, started by agent-walk from the Run a model dialog. A script polled `/api/me/jobs` every 15 s. That API is all the walk watched, and the job tray and the progress window were not open while the run waited. From the POST at 22:09:37 to 22:27:52 every read said status queued, 0 units, units_total null, percent 0, minutes_left null and pause null. So the API carried no GPU wait or pause the screen could have shown. At 22:28:06 it read running with 0 units, at 22:28:22 running 1 of 2 tiles (50 percent), and at 22:28:35 done, 2 of 2 tiles, with finished_at 22:28:34.998. It waited about 18.5 minutes and ran for about 30 s. It never needed cancelling. After the run, the agent's Jobs button read "Jobs, 0 running" in cvut-imaging, the workspace the session had moved to, and its tray did not list the run.

### Recheck on v0.47.0

Rechecked on 2026-11-23 after deploy run 45277243787 finished with success and /api/status named release 4f3491e (v0.47.0), which carries SEC-053 (API answers are never cached) and SEC-052 (admin reads need admin rights).

| Check | Expected | Got |
|---|---|---|
| Signed out, RT-11 objects.csv with a new query string | 401, no HIT | 401, CF-Cache-Status DYNAMIC, Cache-Control private, no-store |
| role-researcher, the same URL | 200, private, no-store | 200 with 30 rows, DYNAMIC, private, no-store |
| Signed out, the same URL right after the researcher | 401 | 401, DYNAMIC |
| Signed out, the plain objects.csv URL that was a HIT before | 401 | 401, DYNAMIC, no Age |
| role-researcher, /api/me | private, no-store | 200, private, no-store |
| role-researcher, /api/tenant/overview, /storage, /webhooks, /security | 403 each | 403, 403, 403, 403 |

The earlier cached entry no longer answers. RT-11 was not deleted, because the API has no route that deletes a review task.

## Interpretation

PROTO-104 fixed the task-less path. Hits that carry a task, which the palette gives inside a task, still miss: a drawn shape in a drawn review does not move the camera, and a cell in an annotate task is centred without zooming or picking. PROTO-159, PROTO-166 and PROTO-157 meet the items that could be walked. PROTO-073's give-up path needs a cold pool to show. PROTO-145's run finishes but still waits far longer to start than the dialog says. EXP-014's tasks cannot run until a participant project can be seeded on the deployed app.

## Follow-ups

New issues, for the lead to file:

1. Cloudflare caches API exports for everyone (security). `GET /api/review-tasks/{task}/evaluation/exports/objects.csv` answered `Cache-Control: max-age=14400` and `CF-Cache-Status: HIT` with Age 232. A request with no cookie then got 200 and the cached 3 data rows, while the same path with an added query string answered 401. The same cache served a decisions CSV of 0 rows after 30 decisions. Probably Cloudflare's default caching of the .csv and .pdf extensions. Sent to the lead at once.
2. A search hit that carries a task does not move the camera to a drawn shape in a drawn review, and centres a cell in an annotate task without zooming or picking it (PROTO-104).
3. The study's first task keeps Start task disabled with no reason when no participant project exists, and calls `/api/projects//review-tasks` (404) (EXP-014).
4. The study code cannot be set, so a moderator cannot match a seeded "Study CODE" project before the participant starts unless the page's code is read first (EXP-014 with EXP-016).
5. The participant seed cannot run from the owner's Mac, because the local Neon key is scoped to the deleted project (EXP-016).
6. After the GPU answered Best at 26 s, the chip read only "Outlining" for 35 s with no wait or progress (PROTO-135).
7. RT-11's evaluation lists its 30 cells under one class "unclassified" while both CSVs name Immune and Stroma (PROTO-159).
8. "1 other devices are signed in" is not made singular (PROTO-157).
9. A whole slide run of 2 tiles sat queued for about 18.5 minutes while its dialog said about 2 minutes and 0 runs ahead (PROTO-145).
