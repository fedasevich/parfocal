# Deployed walkthrough of app.parfocal.eu on v0.35.8

Walked on 2026-11-21 between 08:25 and 09:00 on app.parfocal.eu after release v0.35.8 and its reseed, in the workspace ČVUT Biomedical Engineering. This is the fifth round of backlog task TEST-056 (a walkthrough artifact of the whole deployed app). The fourth round is [2026-11-21-deployed-walkthrough-v0.35.3.md](2026-11-21-deployed-walkthrough-v0.35.3.md), on v0.35.3.

The release did not change during the walk. /api/status named 924242c (v0.35.8) at 08:25, at 08:56 and at 09:01.

Only one account was signed in, the agent test account agent-walk, by the script scripts/agent_session.py. It is a researcher with admin rights and an owner of the projects. The seed makes it a reviewer of RT-1 (Showcase case review) and RT-2 (Cell typing tour), an expert on RT-6 (Annotation example), the adjudicator of one object of RT-3 (Disagreement queue example) and the receiver of one co-sign request. No account was created and the owner's account was not used. No password was typed into a page.

Round four left 23 items open, its 16 new issues and 7 partly fixed older ones. 19 are fixed, 3 are partly fixed and 1 is still open because it waits on the owner. Of the 5 steps round four did not walk, 4 were walked and work and 1 was walked in part.

This round walked 82 steps: the 23 rechecks, the 5 steps not walked before, 33 steps of the training data path and 21 steps going wide. 72 work, 6 are broken (a partly fixed or open recheck counts as broken) and 4 were not walked or walked in part. It found 12 new issues: none high, 4 medium and 8 low.

Does the training data path work end to end? Yes. A slide was uploaded and its job ended as done on every screen after 26 seconds. Find nuclei ran on the whole slide, an imported file gave cells, and a review task was sent. The review was done with number keys, Disagree, Redraw, Change the type and Agree with the rest by mouse, then submitted. The queue showed the reviewer's redraw and retype. A plain Disagree in the queue, and a Disagree after Use this outline, both left the object out of the final layer, the frozen dataset and the consensus export. An Agree kept the AI's outline and class. The adjudicator drew an outline to the end with the Finish outline button. Both tasks were signed off, built, frozen as version 1 and downloaded, and patches with masks and COCO came out of both. An annotate task was signed off from the card above its object list and reached its dataset. One thing on the path is broken, the export button of the sign-off window, which downloads nothing. One thing is a question for the owner, issue 3 (the queue cannot keep a reviewer's new type).

GPU and model calls started by this walk.

- One Find nuclei run on the whole slide (PathoSAM with HoVer-NeXt v1.2), started at 08:30:47. The panel said "Waiting for a GPU" for 48 seconds, then counted 11 tiles. The run took 100 seconds from the click to done by the API's times and 102 seconds on the panel. The model step lasted 52 seconds. It gave 2,428 objects. The run page says 51.3 GPU seconds, and GET /api/tenant/ai-usage answers 51.3 GPU seconds for the same run.
- One embedding call for Smart select with Best, started at 08:46:31. Picking Best sent one POST /embeddings/view with the box of the view, 0.75 seconds later and before any click. The first Best click, 0.9 seconds after picking Best, sent no POST. The second Best click, 11 seconds after, sent no POST. The answer came after 32 seconds. So two Best clicks cost one GPU call. No screen and no API answer counts its GPU seconds.
- No run was started from the Run a model window. It was only read.
- Two patch exports ran as jobs, 19 and 29 seconds, 5.2 MB and 11.6 MB. The local copies were deleted. The app offers no way to delete an export.
- Cost of all of these: TODO, not measured.

What the walk changed and left. RT-3 (Disagreement queue example) is adjudicated and signed off and has a frozen dataset version 1. Slide 1 of RT-1 (Showcase case review) is submitted by the agent account. The slide of RT-6 (Annotation example) is checked and signed off and has a frozen dataset version 1. A new project P04, Walk v0.35.8 training path, holds one uploaded slide, two hand made outlines, an imported result set, a finished model run and the signed off task RT-1 (Review of GeoJSON import) with a frozen dataset version 1. The agent account's session was locked by hand twice and signed in again by the script. A reseed removes all of it.

Two screenshots were saved and both were opened. One is in the HTML page.

## Recheck of the 23 open items of round four

Issues 1 to 16 are the issues round four found. The rows named R are items of round three that round four left partly fixed, and New 9 and New 22 come from round two.

| # | Area | Item | Now | What happened |
|---|---|---|---|---|
| 1 | Dataset | The final layer does not follow the decision made in the disagreement queue | fixed | In RT-3 (Disagreement queue example) a plain Disagree and a Disagree after Use this outline both left the object out. The build reads "11 agreed, 2 edited, 2 rejected". In the walk's own task the owner agreed with the AI on a cell the reviewer had redrawn and retyped, and the zip holds the AI's outline and class. This is the rule of ADR 0419 (the queue decision rules the final layer). |
| 2 | Upload | The upload job waits ten minutes, says Failed, and three screens disagree | fixed | The job was done 26 seconds after it was made. The tray says Done with Open, the notification says "Upload done", the project lists Slide 1, and no call failed. |
| 3 | Cells | With 200 cells the grid hides its count and its Agree with the rest button | fixed | The header "Cells in your sample, 3 of 200" and the button sit at 81 pixels from the top. A mouse click opened the confirm line and a second mouse click applied it with one POST /decisions/batch. |
| 4 | Report | The evaluation report of a cell task says the task has no cells | partly fixed | The report says "1 slide · 200 objects", shows the table of cell types and names each row, such as "Stroma cell". The appendix is wrong, see issue 2 (the report appendix calls every queued object Not sure). |
| 5 | Queue | The queue does not show that the reviewer redrew or retyped the object | fixed | The pane says "1 · Certainly not, redrew the outline, retyped to Immune" and Final outline offers the reviewer's outline with Use this outline. |
| 6 | Models | A finished model run shows no steps, no GPU time and sends no notice | partly fixed | The run page says "Done in 2 min · 51.3 GPU seconds" and "6 of 6" steps, and the notice "Model run finished" came with a link that opens the run. The six step lines are raw keys with wrong figures, see issue 4 (the step list of a run shows raw keys and wrong figures). |
| 7 | Annotate | The sign off card sits under the whole object list | fixed | The card "Sign off this slide" is the first thing under the Find nuclei line, above the AI object list. Its second line starts with a capital letter. |
| 8 | Models | Find nuclei starts with one click and says "0 of 0 tiles" while it waits | fixed | The line under the button names the model and a time before the click. The panel said "Waiting for a GPU" with seconds and a Cancel run button for 48 seconds. The time it names is far off, see issue 6 (the time estimate for a model run). |
| 9 | Adjudication | A key press drops the half drawn outline, and there is no Finish button | fixed | K and X did nothing while five points were placed. The hint says "Decision keys wait until you finish." Finish outline saved the outline and K then decided. |
| 10 | Sign-off | The window miscounts who resolved what and hides objects nobody decided | fixed | "4 disagreements resolved, 4 by you" and "2 of 17 objects not decided by any reviewer. They do not block signing and stay out of the training data". |
| 11 | Models | Run a model picks a slide whose file is missing | fixed | In Breast surgery sentinel nodes only Philips-4.tiff is picked. Missing file.svs is not listed. |
| 12 | Tasks | A task opens on the slide that was already submitted | fixed | After slide 1 was submitted the task opened on CMU-1.ndpi, the second slide. Its counter is off, see issue 8 (the slide counter after a submit). |
| 13 | Phone | Guided review is wider than a phone screen | fixed | At 390 and at 760 pixels the page says "Review needs a wider screen" with Back to My work, and nothing scrolls sideways. |
| 14 | Noise | Calls that are expected to fail | fixed | No call answered 400 or more on home, the upload page, an unsigned dataset page, a slide with cells, the walk's slide, search and Admin. No console warning came from Smart select with Good. Two new failing calls are in issue 10 (two calls that are expected to fail). |
| 15 | Wording | Small slips in numbers and words | partly fixed | A search for an object ID answered in 1.5 seconds and HoVer-Net v0.9 is gone from Admin. The project header still says "1,418 objects with an ID" after a run that added 2,428, the address ?tab=cases still becomes ?tab=slides, and hand made outlines are still listed as M1 and M2 under "Tumor". The Smart select bar now says "Outline found". The rest is in issue 12 (small slips that remain). |
| 16 | Models | The only model in the Run a model window is not served | fixed | The window offers only PathoSAM + HoVer-NeXt, the served model. No run was started from it. |
| R5 | Tasks | Hand drawn shapes cannot be sent to review | still open | It waits on decision 171 (can outlines drawn by hand or with one click tools be reviewed by a second person), which is open in docs/decisions.md. Nothing was tried this round. |
| R10 | Annotate | No way to sign an annotate slide off | fixed | Mark slide checked, then Sign off in the card at the top of the panel. See row 7. |
| R11 | Seed | Reviewers left most objects open | fixed | The seeded reviewers decided 15 of the 17 objects of RT-3 (Disagreement queue example), and the sign-off window counts the 2 nobody decided. |
| R19 | Dataset | Small things on the dataset page | fixed | The dataset page of a task that is not signed off says "Sign off the review task first" and no call answers 409. |
| R20 | Smart select | One Best click asks for the GPU twice | fixed | One POST /embeddings/view left when Best was picked, and neither of the two clicks sent another. |
| New 9 | Tasks | A task never started reads oddly | fixed | RT-8 (Tumour annotation) says "Read only. You are not assigned to this task, so you can look but not change anything." Find nuclei is not offered and no "about 0 min left" shows. |
| New 22 | Wording | Wording slips | fixed | "about 0 min left" is gone from the task with 200 cells. The count of resolved disagreements is now a plural form in the source, and "3 disagreements resolved" and "4 disagreements resolved" were seen. A count of one was not seen on screen. |

The five steps round four did not walk.

| Step | Now | What happened |
|---|---|---|
| The adjudicator draws an outline | walked, works | Five points, Finish outline, PUT /adjudication/.../T5/outline answered 200, "A new outline is settled", then K saved Agree. The outline is in the dataset as edited. |
| Lock after 240 minutes | walked in part | The setting reads 240 minutes in Preferences, 4 hours in Admin and 240 in /api/tenant/session-policy. Lock the screen from the account menu was tried and works. The 240 minutes were not waited. The only message found for the idle lock is the line on the lock card itself. See issue 9 (the lock gives no warning and hides the page by blur only). |
| Compare panes | walked, works | The address ?layout=compare opens a Left and a Right pane, each with its slide, a picker for the other slides of the case, the linked switch, Share my cursor, Compare options and Close compare. |
| A signed case report | walked, works | The report of Showcase case says "Locked as version 1", shows the synoptic block and the signature line, downloads as a PDF of 19 KB and opens the Amend window with a reason field. |
| The Preferences sections | walked, works | All nine sections open with content: Display, Review, Layout, AI and confidence, Navigation and devices, Shortcuts, Notifications, Privacy and session, Account. See issue 11 (opening a page writes). |

## The training data path, step by step

The owner's sentence is "upload a slide, annotate it by hand via one click things or whole slide stuff, have it human reviewed, and in the end produce annotations for AI training". The walk used a new project, the fixture slide CMU-1-Small-Region.svs, and where one account was not enough, the seeded tasks.

| # | Step | Where | Result | What happened |
|---|---|---|---|---|
| 1 | New project | /projects/new | works | P04 was created and the upload page opened. |
| 2 | Upload a slide | /projects/{id}/upload | works | The slide was listed after 29 seconds. The job was made at 08:27:52 and done at 08:28:18. The tray says Done, the notification says "Upload done" and the project lists the slide. No thumbnail call and no /api/uploads/open call failed. |
| 3 | Slide name | project page | works | "Slide 1". |
| 4 | Add an AI result from a file | viewer, Display tab | works | cells.geojson showed 1,418 cells in cyan and was a ready result set after 13 seconds. |
| 5 | New review task | /projects/{id}/tasks/new | works | Six steps, the agent account as the only reviewer, 200 random cells, 5-point certainty. |
| 6 | Find nuclei on the whole slide | viewer, Objects tab | works | One POST /model-runs. "Waiting for a GPU" for 48 seconds, tiles 1 to 11, done after 100 seconds with 2,428 objects. |
| 7 | The run page | /projects/{id}/jobs/{id} | works | "Done in 2 min · 51.3 GPU seconds" and six steps. The step lines read wrong, see issue 4 (the step list of a run shows raw keys and wrong figures). |
| 8 | The run finished notice | /notifications | works | "Model run finished" with Open the run, which opens the run page. |
| 9 | Run a model window | /projects/{id}/run-model | works | Read only. It offers only the served model and leaves out the slide with no file. |
| 10 | One click, Good, and a polygon by hand | viewer, Annotate, S and P | works | The bar said "Outlining" and after 9 seconds "Outline found". Enter saved it with POST /annotations and POST /outline-types. No server model was called. A polygon of four clicks saved too. |
| 11 | One click, Best | viewer, Annotate, S, Best | walked in part | One POST for the view, "Waiting for a GPU" with seconds and Cancel, the answer after 32 seconds. The script pressed Enter and clicked again while it waited, so the bar was not seen to say "Outline found" under Best and no outline was saved. It was not tried again because the two Best clicks were spent. |
| 12 | Number keys and Disagree | the walk's task, Guided | works | Key 1 saved "Certainly not" on three cells and opened the reasons with Redraw the outline and Change the type. |
| 13 | Redraw the outline | the walk's task, Guided | works | Key 5 did nothing while the points were placed. Finish outline saved PUT /edits. |
| 14 | Change the type | the walk's task, Guided | works | One cell became Immune and one became Other. |
| 15 | Agree with the rest on 200 cells | the walk's task, cells mode | works | By mouse. One batched call, 200 of 200. |
| 16 | Opinion and Submit | both tasks | works | The opinion opens by itself and Submit shows the window. |
| 17 | The queue shows the reviewer's edit | /tasks/{id}/disagreements | works | "redrew the outline", "retyped to Immune" and "retyped to Other" next to the answer, and Use this outline for the redrawn cell. |
| 18 | Queue decisions on the walk's task | /tasks/{id}/disagreements | works | "Certainly not" on two cells and "Certainly" on the redrawn one. Each saved and the count went to 0. |
| 19 | Queue decisions on the seeded task | /tasks/{id}/disagreements | works | A plain Disagree, Use this outline then Disagree, and Redraw T1 myself then Agree. The pane says "In the training data, Disagree removes T5, a settled outline included." |
| 20 | The adjudicator draws an outline | /tasks/{id}/adjudicate | works | Drawn to the end with Finish outline, then Agree. |
| 21 | Sign off | /tasks/{id}/sign-off | works | Both tasks were signed right after a fresh sign-in by the script. The refusal on an old sign-in was not tried again. |
| 22 | The final layer follows the queue | /tasks/{id}/dataset | works | The seeded task reads "11 agreed, 2 edited, 2 rejected". The walk's task reads "198 agreed, 0 edited, 2 rejected". |
| 23 | The consensus export follows the queue | GET /api/review-tasks/{id}/slides/{id}/export?consensus=true | works | It holds the same 4 and 9 objects as the dataset for the two seeded slides and 198 for the walk's slide. The export was read from the API. |
| 24 | Dataset page | /tasks/{id}/dataset | works | Filters, counts by origin and by class name, and the objects left out. |
| 25 | Freeze a version | /tasks/{id}/dataset | works | Version 1 with a note, who froze it and a SHA-256, 3.7 KB and 16.5 KB. |
| 26 | Download the version | /tasks/{id}/dataset | works | parfocal-RT-3-dataset-v1.zip and parfocal-RT-1-dataset-v1.zip. Contents are below. |
| 27 | Patches with masks and COCO from the walk's review task | /tasks/{id}/dataset, Cut patches | works | 19 seconds, 5.2 MB, 14 tiles with 14 masks, 202 annotations, four named categories. |
| 28 | Patches from the seeded task | /tasks/{id}/dataset, Cut patches | works | 29 seconds, 11.6 MB, 19 tiles with 19 masks, 24 annotations. |
| 29 | Export from the sign-off window | /tasks/{id}/sign-off | broken | "Download 3 files" downloads nothing. See issue 1 (the export button of the sign-off window downloads nothing). |
| 30 | Sign off an annotate slide | seeded RT-6 (Annotation example) | works | Mark slide checked, then Sign off in the card at the top of the Objects panel. It was accepted on a sign-in 12 minutes old, see issue 5 (an annotate sign-off asks for no fresh sign-in). |
| 31 | Dataset of the annotate task | Export menu and /tasks/{id}/dataset | works | The training dataset zip downloaded. The page lists 17 objects: 13 added by a person, 1 agreed, 3 edited. |
| 32 | Freeze and download the annotate dataset | /tasks/{id}/dataset | works | Version 1, 2.8 KB, parfocal-RT-6-dataset-v1.zip. |
| 33 | Send hand drawn shapes to review | /projects/{id}/tasks/new | not walked | It waits on decision 171 (can outlines drawn by hand or with one click tools be reviewed by a second person). |

### What is in the zips

Dataset version 1 of RT-3 (Disagreement queue example), 3.7 KB. Two GeoJSON files with matching checksums and 13 features.

- Case queue 1 holds T1, T2, T3 and T4. T1 is ai-edited with the outline the owner drew in the queue, author C. T5, decided Disagree after Use this outline, is not in the file. Round four had such an object in its file.
- Case queue 2 holds T2 to T10. T5 is ai-edited with the outline the adjudicator drew. T1, decided with a plain Disagree, is not in the file.
- The manifest counts 2 objects left out as not checked.
- No name, no email address and no at sign is in any file.
- Still wrong: the preset says "annotate-by-hand" for a review task, and model_name is null for the imported set.

Dataset version 1 of the walk's task RT-1 (Review of GeoJSON import), 16.5 KB.

- 198 features, all with origin ai-confirmed.
- The cell that was redrawn and retyped to Immune by the reviewer, and then decided "Certainly" in the queue, is in the file with the AI's outline and the AI's class Other. Round four had it as Immune with the reviewer's outline.
- The cell with a plain "Certainly not" and the cell retyped to Other and decided "Certainly not" are not in the file.
- The manifest counts 1,218 unchecked objects left out.

Patches of the walk's task, 5.2 MB. 14 tiles and 14 masks of 512 pixels, index.csv, manifest.json, annotations.json and the slide's GeoJSON. annotations.json lists 14 images, 202 annotations for the 198 objects and four categories with names.

Patches of RT-3 (Disagreement queue example), 11.6 MB. 19 tiles, 19 masks, 24 annotations for 13 objects, four named categories. Round four had 4 tiles for 3 objects.

Dataset version 1 of RT-6 (Annotation example), 2.8 KB. 17 features: 13 with origin human, 3 ai-edited and 1 ai-confirmed, each with a class name and an author letter. The checksum matches. 4,388 unchecked objects are left out and counted. No name is in it.

## New issues

Ranked by how much each harms the path from a slide to training data.

### 1. The export button of the sign-off window downloads nothing

- Severity is medium.
- Route is `/tasks/{id}/sign-off`.
- Steps. Sign a review task off. In the signed window keep the three ticked files, Evaluation report, Decisions per object and Reviewed annotations, and click Download 3 files.
- What happened. No file was downloaded and no request left the page. It was clicked twice on RT-3 (Disagreement queue example). The web source of the window shows only a message that the files are downloading. The API has the exports under /api/review-tasks/{id}/evaluation/exports and no control in this window calls them. The Training dataset link next to the button was not tried.
- What should happen. The button downloads the ticked files, or the list is replaced by links to the pages that do export.

### 2. The report appendix calls every queued object "Not sure"

- Severity is medium.
- Route is `/tasks/{id}/evaluation`.
- Steps. Sign off the walk's task (200 random cells, one reviewer, three cells answered "Certainly not" and decided in the queue). Open its evaluation and read "Appendix: objects" on page 3.
- What happened. The three cells are listed with "Not sure" under the reviewer and "Not sure" under Decision. The reviewer answered "Certainly not" on all three, and the queue decisions were "Certainly not", "Certainly not" and "Certainly". The table "Objects, worst first" on page 2 says "disagree" for the same cells. Page 1 says "Cell agreement between reviewers 1.00" for a task with one reviewer.
- What should happen. The appendix shows the reviewer's answer and the queue decision. A measure between reviewers reads n/a with one reviewer.

### 3. The queue cannot keep a reviewer's new type for a cell

- Severity is medium.
- Route is `/tasks/{id}/disagreements`, then `/tasks/{id}/dataset`.
- Steps. As the only reviewer answer "Certainly not" on a cell and change its type, with or without a redraw. Submit and open the queue as the owner.
- What happened. The pane shows "retyped to Immune" and offers the five certainty answers. "Certainly not" removes the cell from the training data. "Certainly" keeps the cell with the AI's class, because the edits of a reviewer who disagreed are left out. The pane has no answer that keeps the cell with the reviewer's class. Both outcomes were checked in the zip. This follows ADR 0419 (the queue decision rules the final layer), which speaks of a class answer that the certainty pane does not offer. With one reviewer every disagreement goes to the queue, so a type changed by a reviewer who disagreed does not reach the dataset. A reviewer who agrees and changes the type was not tried.
- What should happen. This is a product question for the owner. One option is a third choice in the pane, "Keep with the reviewer's type", next to Use this outline.

### 4. The step list of a run shows raw keys and wrong figures

- Severity is medium.
- Route is `/projects/{id}/jobs/{id}`.
- Steps. Run Find nuclei on the whole slide, wait, open the run from the Jobs tray or from the notice.
- What happened. The six lines read "tiles-read, one run ahead, 0 min", "tissue-found, 1 levels", "model-running, 11 mm²", "objects-placed, all tiles", "ids-given, 1 cells" and "result-set-added, C1 to C1". The run read 11 tiles, not 11 mm², and gave 2,428 cells, not 1. The tray, the run page and the notice name the run by the key "pathosam-hovernext v1.2" while the viewer says "PathoSAM + HoVer-NeXt".
- What should happen. Step names in words, 11 tiles, 2,428 cells, "C1 to C2428", and the model's display name.

### 5. An annotate sign-off asks for no fresh sign-in

- Severity is low.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=annotate`.
- Steps. Sign in, wait 12 minutes, open RT-6 (Annotation example), click Mark slide checked and then Sign off.
- What happened. POST /slides/{id}/sign-off answered 200 and the slide locked. Round four saw the sign-off of a review task refused on a sign-in 13 minutes old. In the API source the review task sign-off and the sign out of a clinical report ask for a sign-in at most 5 minutes old, and the annotate slide sign-off does not.
- What should happen. One rule for every sign-off that locks training data, or a line in the docs that says why this one differs.

### 6. The time estimate for a model run is far off for a small slide

- Severity is low.
- Route is `/projects/{id}/slides/{id}?tab=objects` and `/projects/{id}/run-model`.
- Steps. Read the line under Find nuclei, then run it on CMU-1-Small-Region.svs.
- What happened. The line says "PathoSAM + HoVer-NeXt on the Parfocal GPU, about 17 min a slide". The run took 100 seconds. The Run a model window says "About 17 min, done around 09:01" for any slide.
- What should happen. An estimate from the slide's size or tile count, or a range.

### 7. A case has no link on the project page

- Severity is low.
- Route is `/projects/{id}`.
- Steps. Open Breast surgery sentinel nodes, which has 3 cases, and look for the report of Showcase case.
- What happened. Each case is a group header with "Upload slides" and "Edit slides" only. A click on the header stays on the page. The address ?tab=cases becomes ?tab=slides with no notice. The report opens from Open report in the viewer's top bar or by typing /projects/{id}/cases/{id}/report. The case named Showcase co-sign has 0 slides, so it has no viewer to start from. It is reached only from the co-sign ask in My work.
- What should happen. The case header links to the case's report.

### 8. The slide counter restarts after a submit

- Severity is low.
- Route is `/tasks/{id}`.
- Steps. Submit slide 1 of 3 of RT-1 (Showcase case review), then open the task again.
- What happened. The task opens on the second slide, which is right. Its top bar says "Slide 1 of 2" and "about 20 min left". My work says "Slide 2 of 3 · about 32 min left" and the submit window said "Next · slide 2 of 3".
- What should happen. One count and one time on both screens.

### 9. The lock gives no warning and hides the page by blur only

- Severity is low.
- Route is the account menu, Lock the screen.
- Steps. Click Lock the screen. Read the page.
- What happened. POST /api/auth/lock answered 204 and a card "You locked the screen" with a password field, Unlock, Unlock with a passkey and Log out covered a blurred page. Every API call then answered 401 with the code session-locked, and a reload went to the sign-in page with return_to. The page under the card is blurred and inert, and its text, project names included, stays in the page. The app's messages hold "Locked after {minutes} minutes without input" for the card of an idle lock, which was not seen on screen, and no message that warns before the lock. The card asks for a password although Admin says sign-in goes through the hosted sign-in. Unlock was not tried because no password is typed by an agent.
- What should happen. The content is removed while locked, as Admin promises with "Slides and names hide until people sign in again". A short warning before an idle lock would save work in a half drawn outline.

### 10. Two calls that are expected to fail

- Severity is low.
- Route is the viewer.
- Steps. Pick Best in Smart select on a slide with no stored embedding. Open RT-2 (Cell typing tour).
- What happened. Picking Best asks GET /api/slides/{id}/embeddings and gets 404, with a console error. Opening the task asks /edits/C181/history and gets 404.
- What should happen. No call that is expected to fail.

### 11. Opening a page writes

- Severity is low.
- Route is `/settings/{section}` and `/projects/{id}/cases/{id}/report`.
- Steps. Open each Preferences section and change nothing. Open the draft report of Showcase draft report and change nothing.
- What happened. Seven of the nine sections sent PUT /api/me/setting-layers when they were opened. The first open of the draft report sent PATCH /clinical-report, and a second open did not. Round one found the same kind of write on opening a slide. Privacy and session says "Two other devices are signed in: a parfocal-agent-session and a parfocal-agent-session", which is the raw client name twice.
- What should happen. A write only after a change. Devices named by browser and place, or counted.

### 12. Small slips that remain

- Severity is low.
- Route is many.
- Steps. Read the screens named below.
- What happened. The Display tab lists "PathoSAM + HoVer-NeXt v1.2 / v1.2". The Objects tab says nothing of a finished run until Load last run is clicked. Admin lists the CAMELYON tumor model as "Always ready" although Run a model no longer offers it. The tray promises a notification when a job finishes and none came for the result import. The GPU seconds of a Best embedding call are shown nowhere, and /api/tenant/ai-usage lists only the model run. The queue pane of an object with no edit lacks the sentence about the training data, and "Disagree goes with Remy Reviewer" does not say the object leaves the dataset. A mouse click on a decision button while an outline is being drawn in the queue decides at once, and the drawing hint stays. The mode switch does not show that cells mode is on.
- What should happen. Counts that match, and one name for each thing.

## Do the viewer tabs and tools fit the task

- Look and Annotate with no task have the full rail with Objects, Display and Comments. Both fit. The Objects tab still lists only measurements, so AI cells and a finished run are seen only in Display.
- Guided has Review, Comments and Display, Submit, Edit shape, Redraw the outline and Change the type. It fits, and keys now wait while an outline is drawn.
- Cells mode now fits 200 cells. Its header stays in view.
- Annotate on an annotate task has Export with the training dataset, the patches and the dataset page, and the sign off card at the top. It fits.
- The disagreement queue shows a single reviewer's outline and new type and says what Disagree and Agree do to the training data. It has no way to keep the new type.
- The adjudication screen has the anonymous reviewers, both outlines and a Finish outline button. It fits.
- Compare has two linked panes with a slide picker on each. It fits.

## Going wide

| Area | Step | Result | What happened |
|---|---|---|---|
| Home | Open home | works | Welcome, start cards, four projects. No call failed. |
| My work | To review, Continue, the co-sign ask | works | "Slide 2 of 3" after the submit, and the adjudication row left the list once decided. |
| Notifications | List and Open the run | works | "Upload done", "New review task" and "Model run finished". The link opens the run page. |
| Search | Words and an object ID | works | "Slide" finds the upload. An object ID lists 13 results in 1.5 seconds. |
| Admin | Overview, People, Projects, Report templates, API and webhooks, Audit log, Security, Workspace settings, AI models, Storage | works | Every section opens with data. The audit log has 397 events for the day. |
| Team, Task timing, Study mode, Developer mode | Open each | works | 13 open tasks and 3 done. |
| Evaluation | RT-2 (Signed-off review) | works | Opens with results and the signature line. |
| Evaluation | The walk's cell task | works | Counts 200 cells and compares their types. The appendix is wrong, see issue 2 (the report appendix calls every queued object Not sure). |
| Tasks | A task never started, RT-8 (Tumour annotation) | works | One clear read only line. |
| Tasks | Reopen a task after a submit | works | Opens on the first slide not submitted. |
| Tasks | RT-2 (Cell typing tour) | works | Opens on its first slide in Guided. One history call answers 404. |
| Phone size | Guided at 390 and 760 pixels | works | "Review needs a wider screen". |
| Preferences | The nine sections | works | Each opens with content. |
| Lock | The setting and Lock the screen | works | 240 minutes on all three places, and the hand lock locks the session on the server. |
| Lock | The lock after 240 minutes of no input | not walked | The brief said not to wait. |
| Drawing | One click with Good and a polygon by hand | works | Both saved with 201 and are listed with area and perimeter. |
| Compare | Two panes side by side | works | Both panes draw their slide and are linked. The screenshot in the HTML page shows it. |
| Cases | The signed report, its PDF and Amend | works | Version 1, locked, 19 KB PDF. |
| Cases | The draft report and the co-sign page | works | The four step report window and the co-sign page open. |
| Cases | Reach a case from the project page | broken | See issue 7 (a case has no link on the project page). |
| Signed out | A page with a locked session | works | Goes to /sign-in with return_to. |

The scripts used are in the session scratchpad and are not in the repository. Keeping one in the repository, which TEST-056 (the deployed walkthrough) asks for, is still TODO. Issue 3 (the queue cannot keep a reviewer's new type) is a question for the owner and is not yet in docs/decisions.md. Following the brief for this round, no board entry and no log line was written, and only this file and its HTML page were committed.
