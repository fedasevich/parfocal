# Deployed walkthrough of app.parfocal.eu on v0.35.3

Walked on 2026-11-21 between 05:20 and 06:10 on app.parfocal.eu after release v0.35.3 and its reseed, in the workspace ČVUT Biomedical Engineering. This is the fourth round of backlog task TEST-056 (a walkthrough artifact of the whole deployed app). The third round is [2026-11-21-deployed-walkthrough-v0.34.1.md](2026-11-21-deployed-walkthrough-v0.34.1.md), on v0.34.1.

The release did not change during the walk. /api/status named de7821f (v0.35.3) at 05:20, at 06:00 and at 06:09.

Only one account was signed in, the agent test account agent-walk, by the script scripts/agent_session.py. It is a researcher with admin rights and an owner of the projects. The seed makes it a reviewer of RT-1 (Showcase case review) and RT-2 (Cell typing tour), an expert on RT-6 (Annotation example), the adjudicator of one object of RT-3 (Disagreement queue example) and the receiver of one co-sign request. No account was created and the owner's account was not used. No password was typed into a page.

Of the 22 items round three left open (its 20 new issues and the 2 partly fixed older ones), 15 are fixed, 7 are partly fixed and none is still broken.

This round walked 84 steps: the 22 rechecks, 36 steps of the training data path and 26 steps going wide. 64 work, 15 are broken (a partly fixed recheck counts as broken) and 5 were not walked. It found 16 new issues: 2 high, 6 medium and 8 low.

Does the training data path work end to end? Yes, with two faults and one dead end beside it. A slide was uploaded, outlined with the one click tools, given cells by Find nuclei on the whole slide and by an imported file, reviewed with number keys, Disagree, Redraw, Change the type and Agree with the rest, submitted, resolved, signed off after a fresh sign-in, built into a final layer, frozen as dataset version 1 and downloaded. Patches with masks and COCO now carry 207 annotations in four named classes in a 5.4 MB zip. An annotate task was signed off and reached its dataset. The two faults are these. The upload job sat in the queue for about ten minutes and then said Failed, although the slide was there and usable. The final layer does not follow the decision made in the disagreement queue when the object has an edit, so one rejected object went into the training data. The dead end is the Run a model window, whose only model is not served.

GPU and model calls started by this walk.

- One Find nuclei run on the whole slide (PathoSAM with HoVer-NeXt v1.2). It took 109 seconds from the click to done, read 11 tiles and gave 2,428 objects. The model step lasted 63 seconds by the run's own times. No screen shows GPU seconds, and the web source has no code that reads them. The API does record them: GET /api/tenant/ai-usage answers 58.6 GPU seconds for this run.
- Two Best clicks in Smart select. The first came one second after Best was picked, and two POST /embeddings/view calls left, whose bodies were not read. The wait for a GPU was 38 seconds. The second came six seconds after Best was picked. Picking Best sent one POST with the box of the view and the click sent none, and the answer came after 36 seconds.
- One CAMELYON tumor model run from the Run a model window. It failed after 21 seconds with the code model-not-served and used no GPU.
- Two accepted Smart select outlines each sent one POST /outline-types call.
- Three patch exports ran as jobs, 19, 15 and 15 seconds, 5.4 MB, 2.1 MB and 5.4 MB. The local copies were deleted. The app offers no way to delete an export.
- Cost of all of these: TODO, not measured.

What the walk changed and left. RT-3 (Disagreement queue example) is adjudicated and signed off and has a frozen dataset version 1. Slide 1 of RT-1 (Showcase case review) is submitted by the agent account. The slide of RT-6 (Annotation example) is checked and signed off by the agent account. A new project P04, Walk v0.35.3 training path, holds two uploaded slides, four hand made outlines, an imported result set, a finished model run, a failed model run and the signed off task RT-1 (Review of GeoJSON import) with a frozen dataset version 1. A reseed removes all of it.

Six screenshots were saved and one was opened. One is in the HTML page.

## Recheck of the 22 open items of round three

Issues 1 to 20 are the issues round three found. New 9 and New 22 are the two round two items that round three left partly fixed.

| # | Area | Item | Now | What happened |
|---|---|---|---|---|
| 1 | Cells | Agree with the rest fails and makes the API answer 500 | fixed | 198 open cells were saved by one POST /decisions/batch that answered 200. The grid said 200 of 200, /api/me answered 200 right after, and a reload showed 200 decisions. |
| 2 | Guided | "Slide 1 submitted" on a failed submit | fixed | One POST /submit was made to answer 500. The page said "The slide was not submitted. Nothing was lost." and stayed on the slide. The next Submit answered 200 and only then showed the window. |
| 3 | Dataset | Patches with masks and COCO hold no labels | fixed | annotations.json has 207 annotations and four categories named Tumor, Stroma, Immune and Other. The manifest has the same classes and "unclassed_left_out" is 0. |
| 4 | Models | Find nuclei on the whole slide never started | fixed | The run started 27 seconds after the click and was done after 109 seconds with 11 of 11 tiles and 2,428 objects. |
| 5 | Tasks | Hand drawn shapes cannot be sent to review | partly fixed | The picker now names the right project and the row says "no PathoSAM v1.2" in place of "no". A slide with only hand drawn shapes still cannot be ticked and no task kind sends those shapes to a second person. |
| 6 | Queue | "Edit T1 myself" opens the slide read only | fixed | "Redraw T1 myself" starts drawing inside the queue. A new outline was saved with PUT /disagreement-queue/.../outline and the pane said "A new outline is settled." |
| 7 | Guided | Number keys pick a class in a certainty task | fixed | Key 5 saved the answer 5 and moved on. Key 1 saved the answer 1 and opened the reasons with Redraw the outline and Change the type. |
| 8 | Dataset | A patch export of one object writes 575 MB | fixed | The same task now gives 4 tiles and 2.1 MB in 15 seconds. The page polled /status seven times, each answer 200, and stopped after the download. |
| 9 | Dataset | Class IDs on the dataset page, no class snapshot | fixed | By class lists Tumor, Stroma, Immune and Other. The manifest has four classes with keys 1 to 4 and every feature has its class_key. |
| 10 | Annotate | No way to sign an annotate slide off | partly fixed | The seed pre-checks the second expert and the Sign off card works. The card sits at the very end of the Objects panel, see issue 7 (the sign off card is under the object list). |
| 11 | Seed | No outline that differs, reviewers left most objects open | partly fixed | RT-3 (Disagreement queue example) has an "outline differs" object and one sent to the agent account. The seeded reviewers still decided 4 of 17 objects, and the sign-off window still has no line for the 13 objects nobody decided. |
| 12 | Guided | Handles and brush have no visible way in | fixed | The object card has "Edit shape" with its key. Redraw the outline and Change the type stay on a decided object. |
| 13 | Guided | No way to the opinion questions after a reload | fixed | After the last object and after a reload Guided opens on the opinion questions. |
| 14 | Upload | An uploaded slide is called "Slide" | fixed | Two uploads of the same file are "Slide 1" and "Slide 2". |
| 15 | Sign-in | A fresh sign-in lands in Machine Learning Lab | fixed | Four sign-ins by the script all opened in Biomedical Engineering. |
| 16 | Tasks | Wording in the task wizard | fixed | "from P04", the name "Review of GeoJSON import", "1 of 1 slide" and a text that says reviewers can redraw. The row for a run that is still queued was not looked at again. "PathoSAM + HoVer-NeXt v1.2 / v1.2" is still shown with the version twice in the Display tab. |
| 17 | Tasks | A task with one reviewer speaks of both reviewers | fixed | "Reviewer vs AI 1", "the reviewer vs AI", "The slide was reviewed by the reviewer" and "1 of 1 review submitted, 1 opinion form". |
| 18 | Review | A queued run of another result set shows inside the review | fixed | The review was opened while Find nuclei ran on the same slide. No banner and no run state showed. |
| 19 | Dataset | Small things on the dataset page | partly fixed | The tab is "RT-1 · Dataset · Parfocal", dates read "21 Nov 2026, 05:33" and an unsigned review task says "Sign off the review task first". The page still asks /dataset and gets 409 for a task that is not signed off. |
| 20 | Smart select | One Best click asks for the GPU twice | partly fixed | With six seconds between picking Best and the click, one POST /embeddings/view left for the view and the click sent none. With one second between them two POSTs left and both answered 200. Their bodies were not read, so the same view is likely and not shown. |
| New 9 | Tasks | A task never started reads oddly | partly fixed | The banner says "Read only. Only the people assigned to this task can do that. You can look at it read only." with nothing tried. Find nuclei is still offered. RT-8 (Tumour annotation) says "about 0 min left". |
| New 22 | Wording | Wording slips | partly fixed | "1 of 1 slide" and "1 opinion form" are right. "about 0 min left" is still on a task with 200 cells, and "1 disagreements resolved" is new. |

The six steps round three did not walk.

| Step | Now | What happened |
|---|---|---|
| Outline differs in the queue | walked, works | T5 on Case queue 2 shows both reviewers' outlines with "Use this outline" and "Draw a new outline". |
| The adjudicator picks or draws an outline | walked in part | Picking the outline of reviewer A saved and showed "Settled". Drawing was started and lost, see issue 9 (a key press drops the adjudicator's drawing). |
| Dataset of an annotate task | walked, works | RT-6 (Annotation example) was signed off and its dataset holds 17 objects. |
| Whole slide model from the Run a model window | walked, broken | The only model offered fails as not served. See issue 16 (the only model in Run a model is not served). |
| Lock after 240 minutes | not walked | The walk was shorter than 240 minutes. |
| Viewer feel | walked in part | A slide with 4,393 cells showed its panel 0.4 seconds after the address was opened. Nothing else was timed and no label was looked at. |

## The training data path, step by step

The owner's sentence is "upload a slide, annotate it by hand via one click things or whole slide stuff, have it human reviewed, and in the end produce annotations for AI training". The walk used a new project, the fixture slide CMU-1-Small-Region.svs, and where one account was not enough, the seeded tasks.

| # | Step | Where | Result | What happened |
|---|---|---|---|---|
| 1 | New project | /projects/new | works | P04 was created and the upload page opened. |
| 2 | Upload a slide | /projects/{id}/upload | broken | The file reached 100% at once. The job then stayed queued for 9 and 11 minutes and ended as Failed. The slides were listed and opened in the viewer all the same. See issue 2 (the upload job fails and three screens disagree). |
| 3 | Slide names | project page | works | "Slide 1" and "Slide 2". |
| 4 | One click, Good | viewer, Annotate, S | works | A click gave an outline and Enter saved it. No server model was called for the outline. |
| 5 | One click, Best | viewer, Annotate, S, Best | works | "Waiting for a GPU" counted to 38 seconds with a Cancel button, then Enter saved the outline. Two embedding calls left for one view. |
| 6 | Find nuclei on the whole slide | viewer, Objects tab | works | One POST /model-runs. "0 of 0 tiles" for 40 seconds, then tiles 1 to 11, done after 109 seconds with 2,428 objects. The result set "PathoSAM + HoVer-NeXt v1.2" was added. No GPU seconds are shown, see issue 6 (a finished run shows no steps and no GPU time). |
| 7 | Run a model window | /projects/{id}/run-model | broken | The window offers only the CAMELYON tumor model and promises about 4 minutes. The run failed after 21 seconds. See issue 16 (the only model in Run a model is not served). |
| 8 | A model with no worker fails with model-not-served | /projects/{id}/run-model | works | The CAMELYON run went from queued to failed with the code model-not-served in 21 seconds and did not wait for a GPU. The screens do not show that code. |
| 9 | Add an AI result from a file | viewer, Display tab | works | cells.geojson showed 1,418 cells in cyan and was a ready result set after 16 seconds. |
| 10 | Send hand drawn shapes to review | /projects/{id}/tasks/new | broken | Slide 2, with four hand made outlines and no AI result, is greyed out with "no PathoSAM v1.2". This is recheck 5 (hand drawn shapes cannot be sent to review). |
| 11 | New review task | /projects/{id}/tasks/new | works | Six steps, the agent account as the only reviewer, 200 random cells, 5-point certainty. |
| 12 | The review shows only its own run | the walk's task, Guided | works | Opened while Find nuclei was running on the slide. Nothing of that run showed. |
| 13 | Number keys answer certainty | the walk's task, Guided | works | 5 and 1 saved the answers 5 and 1. |
| 14 | Disagree with a reason | seeded RT-1 (Showcase case review) | works | Four reasons, a note, Redraw the outline and Change the type. |
| 15 | Redraw the outline | seeded task and the walk's task | works | Five clicks and Finish outline saved PUT /edits. It also worked on an object that was already decided. |
| 16 | Change the type | seeded task and the walk's task | works | T1 became Stroma and cell C781 became Immune. |
| 17 | Edit shape, handles | seeded RT-1 (Showcase case review) | works | The Edit shape button opens Move points, Brush, Split, Merge and Restore the AI original. A dragged point saved. |
| 18 | Edit shape, brush | seeded RT-1 (Showcase case review) | works | Painting added, Shift erased, and each stroke saved. |
| 19 | Restore the AI original | seeded RT-1 (Showcase case review) | works | DELETE /edits/T1 answered 204 and the button left the bar. |
| 20 | Object history | Guided panel | works | "AI original, Tumor", "Changed, new outline", "Changed, Stroma", three more changes with times, then "Back to the AI original". |
| 21 | Agree with the rest on 200 cells | the walk's task, cells mode | works | One batched call, 200 of 200, no 500. The button could only be reached by its keys, see issue 3 (the cells grid hides its own buttons). |
| 22 | Opinion and Submit | both tasks | works | The opinion opens by itself, a failed submit says so, a real submit shows the window. |
| 23 | Disagreement queue | /tasks/{id}/disagreements | works | Seeded and own queues list the objects, and each decision saves and lowers the count. |
| 24 | The outline differs item | /tasks/{id}/disagreements | works | T5 on Case queue 2 offers both outlines. Rhea's or Remy's can be used, or a new one drawn. |
| 25 | Redraw from the queue | /tasks/{id}/disagreements | works | "Draw a new outline" and "Redraw T1 myself" draw in place, and Enter saves. |
| 26 | The adjudicator picks an outline | /tasks/{id}/adjudicate | works | Reviewers show as A and B. "Use this outline" on A saved, Agree saved, "All 1 decided. Ada is told." |
| 27 | The adjudicator draws an outline | /tasks/{id}/adjudicate | not walked | Drawing started, then the K key decided the object and the points were lost. It was not tried again because the object was decided. |
| 28 | Sign off with a fresh sign-in | /tasks/{id}/sign-off | works | Refused with 403 on a sign-in 13 minutes old and sent to the identity provider. Signed after a fresh sign-in by the script. Done for the seeded task and the walk's task. |
| 29 | Final layer | /tasks/{id}/dataset | broken | The builds read "0 agreed, 3 edited, 0 rejected" and "199 agreed, 1 edited, 0 rejected". An object the owner rejected in the queue is in the layer as edited. See issue 1 (the final layer does not follow the queue decision). |
| 30 | Dataset page with class names | /tasks/{id}/dataset | works | Origin, class and slide filters, counts by origin and by class name, and the objects left out. |
| 31 | Freeze a version | /tasks/{id}/dataset | works | Version 1 with a note, who froze it, a SHA-256, 16.8 KB and 2.4 KB. |
| 32 | Download the version | /tasks/{id}/dataset | works | parfocal-RT-1-dataset-v1.zip and parfocal-RT-3-dataset-v1.zip. Contents are below. |
| 33 | Patches with masks and COCO from the walk's task | /tasks/{id}/dataset, Cut patches | works | 19 seconds, 5.4 MB, 15 tiles with 15 masks, 207 annotations, four named categories. The mask pixels hold the class keys 1 to 4. |
| 34 | Patches from the seeded task | /tasks/{id}/dataset, Cut patches | works | 15 seconds, 2.1 MB, 4 tiles for 3 objects on two slides. |
| 35 | Sign off an annotate task | seeded RT-6 (Annotation example) | works | Mark slide checked, then Sign off in the card at the end of the Objects panel. The slide then says "Signed off, this slide is locked." Whether this sign-off also asks for a fresh sign-in was not settled, because the last sign-in was just under five minutes old. |
| 36 | Dataset and training dataset zip of the annotate task | Export menu and /tasks/{id}/dataset | works | "Training dataset (QuPath GeoJSON zip)" downloaded parfocal-RT-6-dataset.zip, 2.9 KB. The dataset page lists 17 objects: 13 added by a person, 1 agreed, 3 edited. |

### What is in the zips

Dataset version 1 of the walk's task RT-1 (Review of GeoJSON import), 16.8 KB.

- manifest.json and one GeoJSON file for the slide. The SHA-256 in the manifest matches the file.
- 200 features: 199 with origin ai-confirmed and 1 with origin ai-edited. The page says the same.
- "classes" holds Tumor, Stroma, Immune and Other with keys 1 to 4, and every feature has its class name and class_key (Stroma 126, Other 33, Immune 31, Tumor 10).
- The edited cell C781 is Immune with class_key 3, author A, changed_by A, source C781, versions 3 and differs_from_ai "both". So a redrawn and retyped object carries its author letter and the ID of the AI original. This is the first walk in which a retyped object reached a zip.
- The manifest counts 1,218 unchecked objects left out and gives the annotator and the signer only as the letter A.
- No name, no email address and no "@" is in any file.
- Still wrong: the preset says "annotate-by-hand" for a review task, and model_name and model_version are null for the imported set.

Dataset version 1 of RT-3 (Disagreement queue example), 2.4 KB. Two GeoJSON files with matching checksums and three features, all ai-edited with class_key 1. T1 of Case queue 1 has the outline the owner drew, author C. T5 of Case queue 1 has the outline of reviewer A that the adjudicator picked. T5 of Case queue 2 has the outline of reviewer B, although the owner's decision on it was Disagree. T1 of Case queue 2, decided Not sure, is left out and counted. 13 objects are left out as not checked.

Patches of the walk's task, 5.4 MB. 15 tiles and 15 masks of 512 pixels, index.csv with the class keys of each tile, manifest.json, annotations.json and the slide's GeoJSON. annotations.json lists 15 images, 207 annotations for the 200 objects (an object on a tile border is cut in two) and four categories with names. Round three had 30 tiles and no annotation. The 15 masks were decoded: 19,369 pixels are not background, with the values 1, 2, 3 and 4 for the four class keys. A tile at the slide edge is 512 by 407 pixels and is not padded.

Patches of RT-3 (Disagreement queue example), 2.1 MB. 4 tiles, 4 masks, 4 annotations, four named categories. Round three had 1,115 tiles and 575 MB.

Training dataset of RT-6 (Annotation example), 2.9 KB. 17 features: 13 with origin human, 1 ai-confirmed and 3 ai-edited, each with a class name and class_key. The checksum matches. Two marks and 4,388 unchecked objects are left out and counted. No name is in it.

## New issues

Ranked by how much each harms the path from a slide to training data. Issue 16 was found last and ranks with the medium ones.

### 1. The final layer does not follow the decision made in the disagreement queue

- Severity is high.
- Route is `/tasks/{id}/disagreements`, then `/tasks/{id}/dataset`.
- Steps. In RT-3 (Disagreement queue example) open T5 on Case queue 2, marked "outline differs". Click Use this outline on the second reviewer, then Disagree. Sign off and open the dataset. Second case: in a task with one reviewer, let the reviewer answer "Certainly not", redraw the cell and retype it to Immune. In the queue answer "Certainly".
- What happened. The queue showed T5 as "Disagree". The build said "0 agreed, 3 edited, 0 rejected", and the zip holds T5 as ai-edited with author B. Round three saw a rejected object with no edit left out, so the settled outline is the likely cause. No control case was run this round. The pane says only "Agree keeps the AI's call" and never says what Disagree means when both reviewers agreed and only their outlines differ. In the second case the owner agreed with the AI that the cell is a tumor cell, and the zip holds it as Immune with the reviewer's outline. The dataset page says "the adjudicator's outcome wins".
- What should happen. Disagree in the queue removes the object from the final layer whatever edits exist. Agree with the AI either drops the reviewer's edit or the queue asks which one to keep. Disagree after Use this outline should be refused or explained.

### 2. The upload job waits ten minutes, says Failed, and three screens disagree about it

- Severity is high.
- Route is `/projects/{id}/upload`, the Jobs tray, `/notifications`, `/projects/{id}/jobs/{id}`.
- Steps. Upload CMU-1-Small-Region.svs (2 MB) into a new de-identified project, twice.
- What happened. The file bar reached 100% at once. /api/me/jobs showed both jobs as queued with 0% from 05:22 and 05:24 until about 05:32, then running, then failed at 05:33. Round three had the slide listed after 26 seconds. The project listed no slide during those minutes. After the failure both slides were listed, opened in the viewer and took an imported result and a model run. The project page still asked for a thumbnail that answered 404. The Jobs tray says "Failed" with no reason, no Open and no retry. The notifications say "Upload done" for both. The job page says "running, Starting, about 0 min" with "Cancel the run". An import of a result file in the same minutes took 16 seconds.
- What should happen. The job starts within seconds or says it waits. One state on all three screens. A failed step names what failed and whether the slide can be used.

### 3. With 200 cells the grid hides its own count and its Agree with the rest button under the top bar

- Severity is medium.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=cells`.
- Steps. Open a task with 200 sampled cells in cells mode in a 1440 by 900 window.
- What happened. The grid is taller than the window and is centred, so its first rows are cut off. "Cells in your sample, 2 of 200", Agree with the rest and the two confirm buttons lie behind the top bar. A mouse click on them lands on the top bar. Shift+K and Enter still work, which is how the walk applied it. The seeded task with 12 cells has a short grid. The screenshot in the HTML page shows the cut.
- What should happen. The header of the grid stays in view and the cells scroll under it.

### 4. The evaluation report of a cell task says the task has no cells

- Severity is medium.
- Route is `/tasks/{id}/evaluation`.
- Steps. Sign off the walk's task (200 random cells, template Cell typing study v1) and open its evaluation.
- What happened. "Slides: 1 slide · 1,418 objects", though 200 were sampled. "100% Cells agreed", though the reviewer disagreed with one cell before the queue. "Cell types, AI against the consensus: This task has no cells, so there are no cell types to compare." The table "Objects, worst first" calls every row "Unclassified cell", though each cell has a class in the dataset.
- What should happen. The report counts the 200 sampled cells, compares their types and names each cell's class.

### 5. The queue does not show that the reviewer redrew or retyped the object

- Severity is medium.
- Route is `/tasks/{id}/disagreements`.
- Steps. As the only reviewer answer "Certainly not" on a cell, redraw it and change its type to Immune. Submit and open the queue as the owner.
- What happened. The pane shows "AI: Tumor, 43% sure" and the reviewer's answer "1 · Certainly not". It shows nothing of the new outline or the new type. Final outline offers only "Draw a new outline if the AI's is wrong". An object with two reviewers shows each reviewer's outline with Use this outline.
- What should happen. The pane shows the reviewer's outline and type next to the AI's and lets the owner pick one, as it does for two reviewers.

### 6. A finished model run shows no steps, no GPU time and sends no notice

- Severity is medium.
- Route is the Jobs tray, `/projects/{id}/jobs/{id}`, `/notifications`, `/admin?section=models`.
- Steps. Run Find nuclei on the whole slide, wait for it, open the Jobs tray and click the run.
- What happened. The tray says "click a model run for its steps". The run page says only "pathosam-hovernext v1.2 · done, started 05:38 by Agent Tester, Done in 2 min". No step, no tile count and no GPU seconds are shown there or in Admin. The API has the figure, 58.6 GPU seconds at /api/tenant/ai-usage, and no screen reads it. The page of a failed job says "running, Starting, about 0 min". The tray names the run by the key "pathosam-hovernext" while the viewer says "PathoSAM + HoVer-NeXt". The tray promises a notification when a job finishes and none came for the run or for the import. On reopening the slide the Objects tab says nothing of the run until Load last run is clicked.
- What should happen. The run page lists the six steps the API already has, with tiles, objects and GPU seconds. The owner pays for GPU time, so the figure should be on screen. A finished run sends its notification.

### 7. The sign off card of an annotate slide sits under the whole object list

- Severity is medium.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=annotate`.
- Steps. Open RT-6 (Annotation example), click Mark slide checked, look for the sign-off.
- What happened. The top bar loses Mark slide checked and keeps only Export. The card "Sign off this slide" with both experts marked Checked and the Sign off button is the last thing in the Objects panel, after 4,393 AI object rows and 15 hand drawn ones. Nothing at the top of the panel says it exists. Its second line starts in lower case, "this slide locks for everyone once you sign it off."
- What should happen. The card sits above the object list, or the top bar shows Sign off once every expert has checked.

### 8. Find nuclei starts a GPU run with one click and says "0 of 0 tiles" while it waits

- Severity is low.
- Route is `/projects/{id}/slides/{id}?tab=objects`.
- Steps. Click Find nuclei with the scope Whole slide.
- What happened. The run started at once. Options shows only scope and order, so the model, the time and the cost are not named before the click. For the first 40 seconds the panel said "0 of 0 tiles, 0 objects" with no word about waiting for a GPU. Smart select says "Waiting for a GPU" with seconds.
- What should happen. The model name and a time estimate next to the button, and the same waiting line as Smart select.

### 9. A key press drops the adjudicator's half drawn outline, and the screen has no Finish button

- Severity is low.
- Route is `/tasks/{id}/adjudicate`.
- Steps. Click Draw a new outline, place five points, press K.
- What happened. K saved Agree, the screen said "All 1 decided" and the five points were gone with no warning. The hint says "Double click or Enter closes the outline" and there is only Cancel drawing. Redraw in Guided has a Finish outline button.
- What should happen. Decision keys are off while drawing, or the screen asks first. The same Finish outline button as in Guided.

### 10. The sign-off window miscounts who resolved what and hides objects nobody decided

- Severity is low.
- Route is `/tasks/{id}/sign-off`.
- Steps. Resolve the queue of RT-3 (Disagreement queue example) as the agent account, which is also its adjudicator, and open the sign-off window.
- What happened. "4 disagreements resolved, 3 by you, 1 by Agent Tester", where both are the same person. "All 2 slides reviewed by both reviewers" with no line for the 13 of 17 objects no reviewer decided. On the walk's task, "1 disagreements resolved".
- What should happen. One count for one person, "1 disagreement", and a line that counts objects nobody decided before signing.

### 11. Run a model picks a slide whose file is missing

- Severity is low.
- Route is `/projects/{id}/run-model`.
- Steps. Open Run a model in Breast surgery sentinel nodes.
- What happened. "The slides without results are picked for you" lists Philips-4.tiff and Missing file.svs, and the button says "Run on 2 slides, about 8 min". The viewer says of the second "The slide file is not available". The run was not started.
- What should happen. A slide that cannot be opened is left out or marked.

### 12. A task opens on the slide that was already submitted

- Severity is low.
- Route is `/tasks/{id}`.
- Steps. Submit slide 1 of 3 of RT-1 (Showcase case review), go to My work, open the task again.
- What happened. My work says "1 of 3 slides, Continue". The task opens on slide 1 with its opinion form, and the top bar still says "about 40 min left".
- What should happen. The task opens on the first slide that is not submitted.

### 13. Guided review is wider than a phone screen

- Severity is low.
- Route is `/tasks/{id}` at 390 pixels wide.
- Steps. Open a review task in a 390 by 844 window.
- What happened. The page is wider than the window and scrolls sideways. Home and My work fit.
- What should happen. A note that review needs a wider screen, or a layout that fits.

### 14. Console and network noise

- Severity is low.
- Route is many.
- Steps. Watch the calls while walking.
- What happened. Every open of a slide with a cell result set asks /api/result-sets/{id}/heatmap and gets 404. The upload page and the result import ask /api/uploads/open and get 404. Home and project pages ask for thumbnails that answer 404, now also for the two uploaded slides. A dataset page of a task that is not signed off gets 409. Smart select writes 13 onnxruntime warnings to the console.
- What should happen. No call that is expected to fail.

### 15. Small slips in numbers and words

- Severity is low.
- Route is many.
- Steps. Read the screens named below.
- What happened. The project header of P04 says "2 result sets, 1,418 objects with an ID" although the model run added 2,428 objects. The viewer chip of "Slide 1" says "Slide 2 of 2". Hand drawn polygons and Smart select nuclei are listed as "Measurements" under "Tumor". The address ?tab=cases becomes ?tab=slides with no notice. A search for the ID C781 still said "Searching" after 3 seconds and listed 13 results after 9. Admin lists HoVer-Net v0.9 as a Parfocal model that is "always ready", and no screen can run it. The Smart select bar never says that an outline was found.
- What should happen. Counts that match, and one name for each thing.

### 16. The only model in the Run a model window is not served

- Severity is medium.
- Route is `/projects/{id}/run-model`, reached from the home card "Run a model, 6 slides have no results yet" and from every slide row.
- Steps. Open Run a model in the new project, keep the one slide and the one model, click Run on 1 slide.
- What happened. The window says "About 4 min a slide on the Parfocal GPU. 0 runs are ahead of yours." POST /model-runs answered 201 and the run stayed queued for 21 seconds, then failed with the code model-not-served. This is what PROTO-145 (Find nuclei runs PathoSAM, a model with no worker fails) intends for a model with no worker. The window still offers that model as the only choice. The tray says "Failed" with no reason, the run page says "running, Starting, about 0 min", and no notification came.
- What should happen. A model with no worker is not offered, or is marked as not available. A failed run says why on the tray and on its page.

## Do the viewer tabs and tools fit the task

- Look and Annotate with no task have the full rail with Objects, Display and Comments. Both fit. The Objects tab lists only measurements, so AI cells and a finished run are seen only in Display.
- Guided has Review, Comments and Display, Submit, and now Edit shape, Redraw the outline and Change the type on every object. It fits.
- Cells mode fits the task for 12 cells. For 200 cells its header is cut off. The mode switch still does not show that cells mode is on.
- Annotate on an annotate task has Export with the training dataset, the patches and the dataset page, which fits. The sign off card is there and is hard to find.
- The disagreement queue now has outline tools, which fits. It does not show a single reviewer's edit.
- The adjudication screen has the anonymous reviewers and both outlines, which fits. Its drawing has no Finish button.

## Going wide

| Area | Step | Result | What happened |
|---|---|---|---|
| Home | Open home | works | Welcome, start cards, four projects. One 404 for a thumbnail. |
| My work | To review, the adjudication row, the co-sign ask | works | The adjudication row names T5 on Case queue 1 and leaves the list once decided. |
| Notifications | List and Open | broken | "Upload done" for two jobs the tray calls Failed, and no notice for the finished or the failed model run. See issue 2 (the upload job fails and three screens disagree) and issue 6 (a finished run shows no steps and no GPU time). |
| Search | Words, an object ID, a full object path | works | "Slide" finds both uploads. The full path finds the one cell. The bare ID is slow. |
| Admin | People, Projects, Report templates, API and webhooks, Audit log, Security, Workspace settings, AI models, Storage | works | Every section opens with data. The audit log has 413 events for the day. |
| Team, Task timing, Study mode | Open each | works | 13 open tasks and 3 done. Timing has two sign-out samples. |
| Developer mode | Ctrl+Shift+D over a slide | works | The drawer footer names the renderer and "100,000 synthetic nuclei", and the mode stays on for the next slide as its page says. |
| Evaluation | The walk's cell task | broken | See issue 4 (the report says the task has no cells). |
| Evaluation | RT-2 (Signed-off review) | works | Three pages with results, the object table and the signature line. |
| Cases | The co-sign ask from My work | works | Opens the co-sign page with both columns. |
| Cells | RT-2 (Cell typing tour) | works | Opens cells mode with 12 cells and a visible Agree with the rest. |
| Tour | Take the tour | works | Step 1 of 10 opens with Stop tour and Next. The other steps were not walked. |
| Phone size | Home, My work, Guided at 390 pixels | broken | Guided scrolls sideways. See issue 13 (Guided review is wider than a phone screen). |
| Workspaces | Switch to Machine Learning Lab and back | works | Its own projects and tasks show, and the switch back holds. |
| Signed out | The dataset address and the download address | works | The page goes to /sign-in with return_to, and the download answers 404. |
| Broken slide | Missing file.svs | works | "The slide file is not available" with Try again. |
| Run a model | Open the window in two projects | works | Opens with the slides and the time. See issue 11 (Run a model picks a slide whose file is missing). The run itself is step 7 of the path. |
| Jobs | The tray and the run page | broken | See issue 2 (the upload job fails and three screens disagree) and issue 6 (a finished run shows no steps and no GPU time). |
| Drawing | Polygon and rectangle by hand | works | Both saved with 201 and are listed with area and perimeter. |
| Models | Load last run | works | Shows "11 of 11 tiles, 2428 objects" again. |
| Project | Tabs and Settings of the new project | works | Privacy, review defaults and the study templates show. |
| Viewer | Open a slide with 4,393 cells | works | The panel showed after 0.4 seconds. |
| Lock | The lock after 240 minutes | not walked | The walk was shorter than 240 minutes. |
| Compare | Two panes side by side | not walked | The address tried did not open a second pane and the button was not tried. |
| Cases | A signed case report | not walked | The script did not find the case list. |
| Preferences | The sections of /settings | not walked | Only the first section was opened. |

The scripts used are in the session scratchpad and are not in the repository. Keeping one in the repository, which TEST-056 (the deployed walkthrough) asks for, is still TODO. Following the brief for this round, no board entry and no log line was written, and only this file and its HTML page were committed.
