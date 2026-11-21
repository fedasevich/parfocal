# Deployed walkthrough of app.parfocal.eu on v0.35.12

Walked on 2026-11-21 between 22:37 and 23:18 UTC (23:37 to 00:18 in Prague) on app.parfocal.eu after release v0.35.12 and its reseed, in the workspace ČVUT Biomedical Engineering. This is the sixth round of backlog task TEST-056 (a walkthrough artifact of the whole deployed app). The fifth round is [2026-11-21-deployed-walkthrough-v0.35.8.md](2026-11-21-deployed-walkthrough-v0.35.8.md), on v0.35.8.

The release did not change during the walk. /api/status named ad05cea (v0.35.12) at 22:37 and at 23:17. The reseed was the Reset production run 44956558900, which ended with success at 22:36.

Only one account was signed in, the agent test account agent-walk, by the script scripts/agent_session.py. It is a researcher with admin rights and an owner of the projects. The seed makes it a reviewer of RT-1 (Showcase case review) and RT-2 (Cell typing tour), an expert on RT-6 (Annotation example), the adjudicator of one object of RT-3 (Disagreement queue example) and the receiver of one co-sign request. No account was created and the owner's account was not used. No password was typed into a page.

This round had two jobs. It rechecked the 16 items round five left open, and it checked on the deployed app the parts of 33 backlog tasks that need the deployed app or the reseed. Each result below covers only that deployed part of a task, never its unit tests or specs.

Of the 16 open items of round five, 9 are fixed, 4 are partly fixed, 2 are still open because they wait on the owner and 1 was walked in part. Of the 33 tasks, 31 pass, 1 could not be checked in full (PROTO-135, Best in Smart select, because the GPU was already warm) and 1 fails in part (PROTO-157, round five small slips, which is still in progress). The walk found 8 new issues: none high, 1 medium and 7 low.

Does the training data path work end to end? Yes. A slide was uploaded and its job ended as done on every screen after 25 seconds. An imported file gave 1,418 cells and sent a notice. A review task of 200 random cells was sent and its first object showed 7.4 seconds later. The review was done with number keys, Change the type, Redraw the outline, Undo and Agree with the rest, then submitted. The queue showed the reviewer's redraw and retype, a "Certainly not" there left the cell out of the dataset, and the task was signed off after a fresh sign-in. The sign-off window downloaded its three files. Version 1 of the dataset was frozen and downloaded, and patches with masks and COCO came out with class names. Find nuclei ran on the whole slide and gave 2,428 cells. An annotate slide was signed off and its dataset and patches were downloaded. Nothing on the path is broken.

GPU and model calls started by this walk.

- Four embedding calls for Smart select with Best, between 22:44:30 and 22:45:09 UTC, two on CMU-1-Small-Region.svs and two on JP2K-33003-1.svs of P03 (Scanner format comparison). GET /api/tenant/ai-usage lists them with 2.653, 1.195, 3.144 and 1.265 GPU seconds, 8.3 GPU seconds in all. The answers took 4.2, 4.4, 4.7 and 2.4 seconds. The other agent had made a Best call on test_065 thirty seconds earlier (21.7 GPU seconds in ai-usage), so the GPU was warm and no "Waiting for a GPU" line showed.
- One Find nuclei run on the whole slide (PathoSAM + HoVer-NeXt v1.2) on the walk's own upload, made at 23:02:26 UTC and done at 23:06:14, 228 seconds. The panel said "Waiting for a GPU" for 149 seconds, then counted 11 tiles. It gave 2,428 objects. The run page and ai-usage both say 66.4 GPU seconds.
- No run was started from the Run a model window. It was only read. The second allowed whole slide run was not used.
- Two patch exports ran as jobs, 15 and 70 seconds, 5.2 MB and 5.7 MB. The downloaded copies sit in the session scratchpad, which is outside the repository and is cleared with the session.
- Cost of all of these: TODO, not measured.

What the walk changed and left. A new project P04, Walk v0.35.12 training path, holds one uploaded slide, an imported result set, a finished model run, one hand drawn polygon and the signed off task RT-1 (Review of GeoJSON import) with a frozen dataset version 1. Slide 1 of RT-1 (Showcase case review) is submitted by the agent account. The one object of RT-3 (Disagreement queue example) that waited for the agent account is adjudicated. The slide of RT-6 (Annotation example) is checked and signed off. The agent account signed in five times by the script, twice into a separate session file, and one of those sessions was locked by hand. The workspace was switched to ČVUT Medical Imaging Group and back. A reseed removes all of it. Nothing was created outside the app.

Four screenshots were saved and one was opened. It is in the HTML page.

## Results for the 33 review tasks

| Task | Result | Evidence |
|---|---|---|
| TEST-020 (showcase seed over every feature and the real fixture slides) | pass | All 15 slides of P03 (Scanner format comparison) reached the ready state in 4 to 6 seconds, each with tile requests answered 200 or 206. synthetic-zlib.ome.tiff made only two. The formats are MIRAX, BIF, NDPI, OME-TIFF, SVS, Philips TIFF, SCN, DICOM, TIFF, Huron TIF, AVS and the CAMELYON TIF. |
| TEST-046 (the dev app holds a ready demo workflow) | pass | Start on RT-1 (Showcase case review) in My work, six regions decided, the opinion answered, Submit, "Slide 1 submitted", and the task reopened on slide 2. The report of RT-4 (Submitted review) opens with results. No error screen and no endless loader. |
| TEST-047 (the demo seed carries real model results) | pass | test_065, CMU-1-Small-Region.svs and Philips-4.tiff each have "Tumour detector v1" (MONAI tumour detection 0.6.4) with 1, 6 and 1 regions and "Cell typer v1" (InstanSeg v0.1.1 with the HoVer-NeXt typer) with 2,038, 1,418 and 5,719 cells, and their cell chunks load in the viewer. |
| TEST-053 (the seed gives audits a task, a case, a finished job and a broken slide) | pass | The agent account has two review tasks, the annotate task RT-6 (Annotation example), the case Showcase case with a signed report, a draft report and a co-sign ask, the finished upload job Philips-4.tiff, and Missing file.svs, which shows "The slide file is not available" with Try again. |
| PROTO-025 (Home, My work, wizards and upload show real images) | pass | Home shows 12 pictures, the project page 14 and the Run a model window 14, all from /api/slides/{id}/thumbnail and all loaded. My work, the task wizard and the upload page show no picture. No request went to /mock-assets/. |
| VIEW-074 (every viewer screen draws the real slide through one engine stage) | pass | Huron-1-40x.tif of RT-2 (Cell typing tour) drew with 7 tile answers in the full viewer and 19 in guided review. The seed has Huron in no annotate task, so annotate was checked on Huron under the address of RT-5 (Tumour outline practice), 7 tiles, and on Philips-3.tiff in RT-6 (Annotation example), 17 tiles. |
| PROTO-070 (compare slides opens on the deployed app) | pass | The rail button opened ?layout=compare, CMU-1.ndpi was picked for the right side, and the page reported both panes as drawn. |
| PROTO-099 (one progress control, one Submit, one notice list, engine drawn adjudication) | pass | Guided review has one Submit button and one notice list. The adjudication screen and the disagreement queue draw the slide on the engine stage, and adjudication has the link Open in Review. |
| PROTO-108 (developer mode opens as a drawer from the palette) | pass | The palette command opened the drawer on a task slide. WebGPU changed the renderer route and showed "The WebGPU route is not built yet. Showing Viv.", and culling None changed the layer from on to off. /developer lists 3 projects and its buttons act. |
| PROTO-109 (an annotate task offers its training dataset and its patches) | pass | The Export menu of RT-6 (Annotation example) lists "Training dataset (QuPath GeoJSON zip)" and "Patches with masks", each with one line. Both downloaded, 2.9 KB and 5.7 MB. The patch window asks for level and tile size and shows "Cutting the patches, Job 69181fd1". |
| PROTO-111 (a reviewer fixes an AI object from the live review card) | pass | On the region T3 and on the cell C1327, Disagree opened the reasons, Redraw the outline and Change the type each saved with PUT /edits answering 200, the AI outline was dimmed under the new one, and Undo sent DELETE /edits answering 204. |
| PROTO-131 (every floating part of the viewer stage has a home zone) | pass | At 1512 by 982 the map sits bottom right in guided review (12 and 13 pixels from the edges) and in Look once zoomed in (12 and 19 pixels). With the part list of the spec, the annotate slide of RT-6 (Annotation example) opened with object=C1 has the magnification bar as its only floating part and C1 uncovered, and guided review has the map, the pan hint and the Back to bar with no overlap. On the first visit of guided review the coach bubble does sit on the object, see issue 4 (guided review opens a small region as a blur). |
| PROTO-133 (a reviewed slide submits, cells mode opens and a task's state reads true) | pass | Slide 1 of RT-1 (Showcase case review) submitted and My work says "1 of 3 slides, In progress". RT-2 (Cell typing tour) opens with "Cells, 0 of 12" and belongs to the agent account. RT-8 (Tumour annotation) shows no lock, a slide outside a task shows "This slide is not part of the task" with two ways back, and the decided adjudication reads "1 of 1 decided". |
| PROTO-134 (signing with single sign-on asks for the sign-in step) | pass | On a sign-in 23 minutes old, Sign with single sign-on got 403 fresh-sign-in-needed and the page went to the hosted sign-in, which asked for the password. Nothing was typed there. After a new sign-in by the script the same button signed. So the fresh sign-in step does appear. |
| PROTO-135 (Best in Smart select answers or says why it cannot) | cannot | A cold Best could not be measured, because the other agent had warmed the GPU 30 seconds before. Warm, Best answered in 2.4 to 4.7 seconds and the bar said "Outline found" 7.6 seconds after the click, with no fallback notice. The wait line was not seen. Another agent measured the cold call the same night in [2026-11-21-best-embedding-on-a-cold-pool.md](2026-11-21-best-embedding-on-a-cold-pool.md), 27.7 seconds with one 200 answer. That file does not say whether the wait line showed on screen, so this part stays open. |
| PROTO-143 (Agree with the rest holds at 200 cells) | pass | The seed has no slide with a 200 cell sample, its cell task has 12 cells a slide, so the walk's own task of 200 cells was used. "Agree with 197" sent one POST /decisions/batch, which answered 200, and the grid read 200 of 200. No call answered 500. |
| PROTO-144 (patches and the dataset carry class names) | pass | The dataset page lists Stroma 133, Other 32, Tumor 8 and Immune 25. The frozen zip and the patch zip name the four classes, and annotations.json has 14 images, 202 annotations and four named categories. The export took 15 seconds, 5.2 MB, with no failed poll. |
| PROTO-145 (whole slide cell detection starts, and a review shows only its own runs) | pass | The run started and finished in 228 seconds with 66.4 GPU seconds. The review of the same slide shows only its own result set, GeoJSON, and no line about the run anywhere on the page. For Best, picking Best plus one click made two GPU calls both times it was tried, see issue 6 (picking Best and then clicking beside the view makes two GPU calls). The lead decides whether that meets "one Best click makes one GPU call". |
| PROTO-146 (every way into editing a reviewed object is visible and works) | pass | "Redraw C1327 myself" in the queue opened drawing with Finish outline. Keys 5, 3 and 1 saved on a 5 point task and K, X and U on a 3 point task. Edit shape opened Move points, Brush, Split and Merge with 20 handles. The opinion questions show after a reload. The 2 point task was not tried. |
| PROTO-147 (an annotate task can be signed off and the seed has a real outline disagreement) | pass | RT-6 (Annotation example) was marked checked, signed off and its dataset downloaded. The agent account had T5 on Case queue 2 with the outlines of reviewers A and B, picked "Use this outline" and agreed. |
| PROTO-148 (names and wording after an upload and in the task wizard) | pass | After a switch to ČVUT Medical Imaging Group a new sign-in by the script landed there. The upload is listed as "Slide 1" in a de-identified project. The six wizard steps read without a slip. |
| PROTO-149 (the final layer follows the queue decision and the queue shows a single reviewer's edits) | pass | The queue pane says "1 · Certainly not, redrew the outline, retyped to Tumor". After "Certainly not" there the build reads "198 agreed, 0 edited, 1 rejected" and C1327 is not in the zip. |
| PROTO-150 (upload and model run jobs tell one story and Run a model offers only served models) | pass | The upload job was done 25 seconds after it was made, and the upload page, the tray, the notice and the project agree. Run a model offers only PathoSAM + HoVer-NeXt and leaves out Missing file.svs. The waiting run said "Waiting for a GPU". |
| PROTO-151 (review and annotate panels keep their controls in reach) | pass | The grid header and Agree with the rest sit 103 pixels from the top with 200 cells. The sign-off card is above the object list. Key 5 did nothing while an outline was drawn and Finish outline is there. The task reopened on slide 2. At 375 pixels the page says "Review needs a wider screen" and is 375 pixels wide. |
| PROTO-152 (the evaluation report of a cell task counts its cells and names their types) | pass | "1 slide · 200 objects", a table of Immune, Other, Stroma and Tumor, and rows such as "Stroma cell". The CSV of the same task does not name them, see issue 1 (the decisions file calls every cell unclassified). |
| PROTO-153 (round four slips, noise and the partly fixed items) | pass | No call failed and no console error came on Home, My work, the projects, the wizard, upload, the nine Preferences sections, the reports and 15 slides. The seeded reviewers left 4 of 17 objects of RT-3 (Disagreement queue example) for the queue. Noise that remains is in issue 5 (calls that answer 404 or 409 on purpose). A click 1.1 seconds after picking Best sent a second embedding call, see issue 6 (picking Best and then clicking beside the view makes two GPU calls). |
| PROTO-154 (sign-off export, the report appendix and a fresh sign-in for annotate sign-off) | pass | "Download 3 files" downloaded the report PDF (270 KB), the decisions CSV (42 KB) and the annotations JSON (73 KB). The appendix lists only the queued cell, C1327, with "1 · Certainly not" for the reviewer and for the decision. The agreed and the unsure cells are named right in the table "Objects, worst first", where C560 reads unsure and C11 agree. An annotate sign-off on a sign-in 8 minutes old got 403 and the sign-in step. |
| PROTO-155 (a run's page speaks plainly and its estimate fits the slide) | pass | "Tiles read", "Tissue found, 1 level", "Model running, 11 tiles", "Objects placed, 2,428 cells", "IDs given, C1 to C2428" and "Done in 4 min · 66.4 GPU seconds". The line under Find nuclei said "about 2 min for this slide", and 99 minutes for Philips-3.tiff. |
| PROTO-156 (the lock warns and hides the page, and opening a page writes nothing) | pass | With the page clock moved to about 3 hours 58 minutes without input the alert "The screen locks soon without input. Press a key or click to keep working." showed. After Lock the screen the page held no slide, case or project text and its title was "Parfocal". No Preferences section and no draft report sent a write. The lock card of the idle lock itself was not seen, see the note under the table. |
| PROTO-157 (round five small slips, in progress) | fail in part | The case header now has Open report and the counter says "Slide 2 of 3" on both screens. Still there: 20 minutes left in the top bar against 32 in My work, "v1.2 / v1.2" in the Display tab, "1,418 objects with an ID" after a run that added 2,428, ?tab=cases turning into ?tab=slides, and raw device names in Privacy and session. |
| PROTO-158 (a result import notice, GPU seconds for Best and names for hand drawn outlines) | pass | The notice "Import done" came 13 seconds after Add result set. ai-usage lists each Best call as view-embedding with its GPU seconds. A hand drawn polygon is still listed as M1, and that is now decision 174 (which ID does an outline drawn by hand or with one click get) in docs/decisions.md. |
| OPS-029 (a queued job starts a worker in the deployed app) | pass | The task was sent at 22:56:40 UTC. /objects answered 409 after 0.8 and 4.0 seconds and 200 after 7.4 seconds, and the first object showed. |
| OPS-035 (agents get a signed-in session on the dev app) | pass | The saved session opened 15 seeded slides in Playwright with the installed Chrome. |

Note on the idle lock. The web app locks after 240 minutes without input. The page clock of Playwright was moved forward instead of waiting. The warning showed between 3 hours 57 minutes and 3 hours 58 minutes 30 seconds. The clock was then moved 7 minutes 30 seconds further and the warning stayed with no lock card. The web source shows why: when the idle time is up the page asks the server for the session, and the server locks. The server still saw a fresh session, because only the page clock was moved, so no lock is expected here and this is not an issue. The lock by hand was used to check the locked page.

## Recheck of the 16 open items of round five

Issues 1 to 12 are the issues round five found. The other rows are what round five left partly fixed, still open or not walked.

| # | Area | Item | Now | What happened |
|---|---|---|---|---|
| 1 | Sign-off | The export button of the sign-off window downloads nothing | fixed | Three files downloaded, each from /evaluation/exports with 200. |
| 2 | Report | The report appendix calls every queued object "Not sure" | fixed | C1327 reads "1 · Certainly not" under the reviewer. The decision read "Open" before the queue decision and "1 · Certainly not" after it. "Cohen's κ, reviewers" reads n/a with one reviewer. |
| 3 | Queue | The queue cannot keep a reviewer's new type for a cell | still open | The pane still offers the five certainty answers only. It waits on decision 173 (can the disagreement queue keep the reviewer's type), which is open in docs/decisions.md. |
| 4 | Models | The step list of a run shows raw keys and wrong figures | fixed | Six lines in words with 11 tiles, 2,428 cells and "C1 to C2428". The notice still names the run by its key, see issue 7 (small slips found this round). |
| 5 | Annotate | An annotate sign-off asks for no fresh sign-in | fixed | 403 fresh-sign-in-needed on a sign-in 8 minutes old, then the hosted sign-in. |
| 6 | Models | The time estimate for a model run is far off for a small slide | fixed | "About 2 min for this slide" for a run whose model part took 79 seconds after 149 seconds of waiting for a GPU. |
| 7 | Cases | A case has no link on the project page | fixed | The header of Showcase case has Open report. |
| 8 | Tasks | The slide counter restarts after a submit | partly fixed | "Slide 2 of 3" in the top bar and in My work. The top bar says "about 20 min left" and My work "about 32 min left". |
| 9 | Lock | The lock gives no warning and hides the page by blur only | fixed | The warning alert showed, and the locked page holds no slide, case or project text in its markup. |
| 10 | Noise | Two calls that are expected to fail | fixed | GET /embeddings answers 204 before the first Best call, and opening RT-2 (Cell typing tour) made no failing call. |
| 11 | Writes | Opening a page writes | partly fixed | None of the nine Preferences sections and none of the three reports sent a write. Privacy and session still says "4 other devices are signed in: a parfocal-agent-session, a parfocal-agent-session, a parfocal-agent-session and a parfocal-agent-session". |
| 12 | Wording | Small slips that remain | partly fixed | Fixed: the Objects tab says "A run finished on this slide. Load last run shows it.", the import sends a notice, ai-usage counts Best, and the queue pane of a single reviewer says what Disagree does to the training data. Still there: "PathoSAM + HoVer-NeXt v1.2 / v1.2" in the Display tab, the CAMELYON tumor model in Admin, and the Cells switch has no pressed state in its markup. |
| R4-15 | Wording | Small slips in numbers and words, from round four | partly fixed | The project header says "1,418 objects with an ID" after a run that added 2,428, and ?tab=cases still becomes ?tab=slides. The M1 name of a hand drawn outline is now decision 174 (which ID does an outline drawn by hand or with one click get). |
| R5 | Tasks | Hand drawn shapes cannot be sent to review | still open | It waits on decision 171 (can outlines drawn by hand or with one click tools be reviewed by a second person). Nothing was tried. |
| Best | Smart select | One click with Best was walked in part | fixed | Best outlined the click. The bar said "Best" and "Outline found" and the layer reported the server encoder. |
| Lock | Lock | The lock after 240 minutes was not walked | walked in part | See the note on the idle lock above. |

## The training data path, step by step

The walk used a new project, the fixture slide CMU-1-Small-Region.svs and the cells file of the test fixtures.

| # | Step | Where | Result | What happened |
|---|---|---|---|---|
| 1 | New project | /projects/new | works | P04 was created and the upload page opened. |
| 2 | Upload a slide | /projects/{id}/upload | works | The job was made at 22:50:27 UTC and done at 22:50:52. The page said 5 of 5 steps, the tray Done, the notice "Upload done" and the project listed "Slide 1". |
| 3 | Add an AI result from a file | viewer, Display tab | works | cells.geojson showed 1,418 objects in cyan, Add result set saved it, and it was ready after about 20 seconds. The notice "Import done" came. |
| 4 | New review task | /projects/{id}/tasks/new | works | Six steps, the agent account as the only reviewer, 200 random cells, 5-point certainty. |
| 5 | First object after sending | /tasks/{id} | works | 7.4 seconds from the answer of the send to the first /objects with 200. |
| 6 | Number keys | the walk's task, Guided | works | Key 5 saved "Certainly", key 3 "Can't tell" and key 1 "Certainly not", which opened the reasons. |
| 7 | Change the type and Undo | the walk's task, Guided | works | PUT /edits with the new class, then Undo sent DELETE /edits. |
| 8 | Redraw the outline | the walk's task, Guided | works | Four points, key 5 ignored while drawing, Finish outline saved. The cell was then retyped to Tumor and kept. |
| 9 | Agree with the rest on 200 cells | the walk's task, cells mode | works | One batched call for 197 cells, 200 of 200. |
| 10 | Opinion and Submit | the walk's task | works | The four questions show after a reload. Submit showed "Slide 1 submitted". |
| 11 | Evaluation report | /tasks/{id}/evaluation | works | 200 objects, the type table, C1327 as disagree and C560 as unsure. |
| 12 | The queue shows the reviewer's edit | /tasks/{id}/disagreements | works | "redrew the outline" and "retyped to Tumor", with Use this outline. |
| 13 | Edit from the queue | /tasks/{id}/disagreements | works | "Redraw C1327 myself" opened drawing with Finish outline. It was cancelled. |
| 14 | Queue decision | /tasks/{id}/disagreements | works | "Certainly not" saved and the count went to 0. |
| 15 | Sign off on an old sign-in | /tasks/{id}/sign-off | works | Refused with 403 and sent to the hosted sign-in. |
| 16 | Sign off on a fresh sign-in | /tasks/{id}/sign-off | works | Signed, with a checksum. |
| 17 | Download 3 files | /tasks/{id}/sign-off | works | PDF, CSV and JSON. The CSV has a wrong class column, see issue 1 (the decisions file calls every cell unclassified). |
| 18 | The final layer follows the queue | /tasks/{id}/dataset | works | "198 agreed, 0 edited, 1 rejected, 0 added, 1 unsure and 0 open left out". |
| 19 | Freeze and download a version | /tasks/{id}/dataset | works | Version 1, 16.5 KB, 198 features, all ai-confirmed, each with a class name. C1327 is not in it. No at sign is in the file. |
| 20 | Patches with masks and COCO | /tasks/{id}/dataset, Cut patches | works | 15 seconds, 5.2 MB, 14 tiles with 14 masks, 202 annotations, four named categories. |
| 21 | Find nuclei on the whole slide | viewer, Objects tab | works | 228 seconds, 11 tiles, 2,428 objects, 66.4 GPU seconds. |
| 22 | The run page | /projects/{id}/jobs/{id} | works | Six steps in words and the GPU seconds. |
| 23 | The run finished notice | /notifications | works | "Model run finished" with Open the run. |
| 24 | A polygon by hand | viewer, Annotate, P | works | Saved with 201 and listed under Tumor as M1 with its area and perimeter. |
| 25 | Export menu of an annotate task | seeded RT-6 (Annotation example) | works | Six entries, the training dataset and the patches among them. |
| 26 | Sign off an annotate slide | seeded RT-6 (Annotation example) | works | Refused on a sign-in 8 minutes old, accepted on a fresh one. "1 of 1 slide checked, 1 signed off". |
| 27 | Dataset and patches of the annotate task | Export menu | works | parfocal-RT-6-dataset.zip, 2.9 KB, and parfocal-RT-6-patches.zip, 5.7 MB after 70 seconds. |
| 28 | Send hand drawn shapes to review | /projects/{id}/tasks/new | not walked | It waits on decision 171 (can outlines drawn by hand or with one click tools be reviewed by a second person). |

## New issues

Ranked by how much each harms the path from a slide to training data. The agent workflow file does not let a walk agent add backlog tasks, so none was added. Each issue below needs one.

### 1. The decisions file calls every cell unclassified

- Severity is medium.
- Route is `/tasks/{id}/sign-off`, Download 3 files.
- Steps. Sign off a cell task of 200 cells and download "Decisions per object" as CSV.
- What happened. All 200 rows have "unclassified" in the class column. The evaluation report of the same task names the AI's type of each cell, such as "Stroma cell", and the dataset zip names the class of each object.
- What should happen. The class column holds the AI's class name, as the report does.

### 2. The Upload button of the top bar leaves the project

- Severity is low.
- Route is `/projects/{id}/upload`.
- Steps. On the upload page of the walk's project P04 (Walk v0.35.12 training path), with one file picked and the Check step open, click Upload in the top bar.
- What happened. The page went to the upload page of P01 (Sentinel node metastasis study) with nothing picked. The picked file was dropped with no question. The click was made by the walk script, which meant the upload button of the step.
- What should happen. The top bar button stays in the project that is open, or asks before dropping picked files.

### 3. A slide outside an annotate task opens with no notice

- Severity is low.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=annotate`.
- Steps. Open Huron-1-40x.tif under the address of RT-5 (Tumour outline practice), which holds test_065 and Argos-1.avs only.
- What happened. The annotate viewer opened with the task name, a counter that says only "Slide" and all tools. /check-status and /threads answered 404. A review task with a slide outside it shows "This slide is not part of the task" with two ways back.
- What should happen. The same notice as a review task.

### 4. Guided review opens a small region as a blur and the first coach bubble covers it

- Severity is low.
- Route is `/tasks/{id}` of RT-1 (Showcase case review).
- Steps. Start the task from My work and look at the first object, T3.
- What happened. T3 is 15 µm across, so the view opens at 297× and the tissue is a field of large pixels. Coach bubble 1, "The AI found this. It is outlined in white.", sits on the middle of the outline. The name under the map is cut at the map's edge. The screenshot in the HTML page shows it.
- What should happen. A zoom limit near the scan's own magnification for small objects, the bubble beside the outline, and the seed with regions of a realistic size.

### 5. Calls that answer 404 or 409 on purpose

- Severity is low.
- Route is the viewer.
- Steps. Open a task right after it is sent. Open a slide outside a review task.
- What happened. /objects answered 409 twice while the task was prepared, each with a console error. The page for a slide outside a task asked /objects, /opinion and /decisions and got 404 for each.
- What should happen. No call that is expected to fail, or no console error for it.

### 6. Picking Best and then clicking beside the view makes two GPU calls

- Severity is low.
- Route is the viewer, Smart select, Best.
- Steps. Pick Best and click 60 pixels left of the middle of the stage, 1.1 seconds later or after the first answer.
- What happened. Picking Best sent one POST /embeddings/view for a 512 pixel box at the middle of the view. The click sent a second POST for a box around the click. Both times two calls were billed, 3.8 and 4.4 GPU seconds for the pairs. The request bodies were logged only the second time, so the two boxes are known for that try alone. Round five clicked inside the first box and saw one call.
- What should happen. This may be as designed. If so, the first call could wait for the click, since it is wasted when the click falls outside its box.

### 7. Small slips found this round

- Severity is low.
- Route is many.
- Steps. Read the screens named below.
- What happened. The notice of a finished run says "pathosam-hovernext v1.2 finished on its slide." while every other screen says PathoSAM + HoVer-NeXt. The job of that run counts 16 of 16 units while the panel says 11 of 11 tiles. The import job still read "running" in /api/me/jobs 10 seconds after its result set was ready and its notice was sent. The header of the walk's project says "100% reviewed" although nobody reviewed the 2,428 cells of the run.
- What should happen. One name and one count for each thing.

### 8. The walkthrough script is still not in the repository

- Severity is low.
- Route is none.
- Steps. Look for a deployed walk script. apps/web/e2e/production-scenes.spec.ts builds a local preview with a mocked API, and apps/web/e2e/flow-map.spec.ts runs on the fake API.
- What happened. Neither walks the deployed app, so this round wrote its scripts in the session scratchpad again, about 20 small files.
- What should happen. TEST-056 (the deployed walkthrough) keeps one script in the repository that signs in with the saved session and walks the read only part.

## Going wide

| Area | Step | Result | What happened |
|---|---|---|---|
| Home | Open home | works | 12 real thumbnails, no failed call. |
| My work | To review, Start, Continue, the co-sign ask | works | Four rows before the walk, and the adjudication row left once decided. |
| Projects | The three seeded projects and the walk's new one | works | Each lists its slides with thumbnails. |
| Slides | One of each format | works | 15 of 15 ready. |
| Slides | A slide with no file | works | The failure notice with Try again. |
| Compare | Two panes side by side | works | Both panes drawn. |
| Developer | The drawer and /developer | works | Both act on the viewer. |
| Adjudication | The outline pick and Agree | works | "All 1 decided. Ada is told." |
| Disagreements | RT-3 (Disagreement queue example) | works | 4 of 17 objects need a decision, one of them marked outline differs. |
| Cases | The signed report, the draft and the co-sign page | works | All three open and none writes on opening. |
| Evaluation | RT-4 (Submitted review) and the walk's task | works | Both open with results. |
| Preferences | The nine sections | works | Each opens and none writes. |
| Jobs | The tray | works | Four finished jobs, each Done with Open. |
| Notifications | The list | works | Eight notices, the run, the import and the upload among them. |
| Admin | AI models | works | Lists two Parfocal models. |
| Phone size | Guided at 375 pixels | works | "Review needs a wider screen". |
| Workspace | Switch and sign in again | works | The new sign-in landed in the workspace used last. |
| Lock | Lock the screen by hand | works | The page text is removed and every call answers 401. |
| Lock | The idle lock after 240 minutes | walked in part | The warning was seen with a moved page clock. The lock card was not. |
| Smart select | Best, cold | not walked | The GPU was warm. |

The scripts used are in the session scratchpad and are not in the repository. Following the brief for this round, no board entry and no log line was written, no task was ticked and nothing was committed.
