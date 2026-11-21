# Deployed walkthrough of app.parfocal.eu on v0.34.1

Walked on 2026-11-21 between 02:25 and 03:35 on app.parfocal.eu after release v0.34.1 and its reseed, in the workspace ČVUT Biomedical Engineering. This is the third round of backlog task TEST-056 (a walkthrough artifact of the whole deployed app). The second round is [2026-11-20-deployed-walkthrough-v0.29.1.md](2026-11-20-deployed-walkthrough-v0.29.1.md), on v0.29.1.

The release changed during the walk. /api/status named a2061ad (v0.34.1) at 02:25 and a7726a4 (v0.34.2) at 03:23. Everything up to the review of the walk's own task ran on v0.34.1. The first Agree with the rest was at about 03:21, when the release may already have been changing. The sign-off of the walk's own task, its dataset, its patches, the second Agree with the rest and the annotate task ran on v0.34.2.

Only one account could be signed in, the agent test account agent-walk, by the script scripts/agent_session.py. It is a researcher with admin rights and an owner of the projects. The seed makes it a reviewer of RT-1 (Showcase case review) and RT-2 (Cell typing tour), an expert on RT-6 (Annotation example), the adjudicator of one object of RT-3 (Disagreement queue example) and the receiver of one co-sign request. No account was created and the owner's account was not used. No password was typed into a page. A second reviewer could not be played, so every step that needs two signed in reviewers is marked not walked.

Of the 27 items round two left open (its 22 new issues and the 5 older steps that were still broken or partly fixed), 25 are fixed, 2 are partly fixed and none is still broken.

This round walked 78 steps: the 27 rechecks, 32 steps of the training data path and 19 steps going wide. 64 work, 8 are broken (a partly fixed recheck counts as broken) and 6 were not walked. It found 20 new issues: 4 high, 8 medium and 8 low.

Does the training data path work end to end? Partly. A slide was uploaded, outlined with the one click tools, given an imported cell result, reviewed with Disagree, a brushed outline and a changed type, submitted, resolved, signed off after a fresh sign-in, built into a final layer, frozen as dataset version 1 and downloaded. The zip is right: the edited cell carries its author letter and the ID of the AI original, the rejected cell is absent, every checksum matches and no name is in it. Four things break the path. The whole slide model never started. Agree with the rest fails for most cells and makes the API answer 500. The patches with masks and COCO from a review task hold no labels at all. Shapes drawn by hand cannot be sent to a review task.

GPU and model calls. One Best click in Smart select sent two POST /embeddings/view calls, which waited 19 seconds for a GPU and answered. One Find nuclei click queued one whole slide model run (HoVer-Net v0.9), which never left the queue in 17 minutes and was cancelled, so it used no GPU time as far as the API shows. Two accepted outlines each sent one POST /outline-types call. Two patch exports ran as jobs, and one of them wrote a 575 MB zip. Cost of all of these: TODO, not measured. No CAMELYON run was started.

What the walk changed and left. RT-3 (Disagreement queue example) is adjudicated and signed off and has a frozen dataset version 1. Slide 1 of RT-1 (Showcase case review) is submitted by the agent account with T1 redrawn and retyped. The slide of RT-6 (Annotation example) is marked checked by the agent account. A new project P04, Walk v0.34.1 training path, holds one uploaded slide, two smart select outlines, an imported result set, a cancelled model run, the signed off task RT-1 (GeoJSON import) with a frozen dataset version 1, and the task RT-2 (GeoJSON import) with 80 of 200 cells agreed. A reseed removes all of it.

Five screenshots were saved and one was opened. One is in the HTML page. Other agents were active on the deployed app during the walk, and the worktree of this walk held another agent's uncommitted code, which was left alone.

## Recheck of the 27 open items of round two

Old 1, 4, 9, 16 and 26 are the round one steps that round two left open. New 1 to 22 are the issues round two found.

| # | Area | Item | Now | What happened |
|---|---|---|---|---|
| Old 1 | Release | /api/status names the release | fixed | The status answers "release":"a2061ad", and later "a7726a4". |
| Old 4 | Projects | Old tab names in the address | fixed | ?tab=results becomes ?tab=slides and a notice says "The Results tab moved to Slides." |
| Old 9 | Viewer | A hint setting is written on every tool change | fixed | H, V, V, O, L, H, O, L sent four PUT /api/me/setting-layers, one for each tool. The Preferences sections were clicked while the API was failing, so they are not rechecked. |
| Old 16 | Cells | Type a cell | fixed | The agent account is a reviewer of RT-2 (Cell typing tour). Cells mode opens with 12 sampled cells. Cells were decided in the walk's own task. |
| Old 26 | Jobs | Click the finished job | fixed | The tray now says "click a model run for its steps". The steps of a model run were not seen, because the walk's run never started. |
| New 1 | Guided | A reviewed slide cannot be submitted | fixed | Submit is in the top bar next to Open report, off until every object and the opinion are answered. "Slide 1 submitted" came with the next slide offered. |
| New 2 | Cells | Cells mode does not open | fixed | /tasks/{id}/cells opens mode=cells with the grid of 12 cells. The mode switch still lists only Guided, Review and Annotate. |
| New 3 | Signing | Sign with single sign-on signs at once | fixed | On a sign-in older than 5 minutes POST /sign-off answers 403 and the browser goes to the identity provider's password page. After a fresh sign-in by the script the same click signed. The password step in the browser was not walked. |
| New 4 | Smart select | Best never answered | fixed | "Waiting for a GPU" counted to 19 seconds with a Cancel button, then the outline came and Enter saved it. |
| New 5 | Review | "Cells 18,240" on every slide | fixed | The block now says "12 in your sample" on cell slides and "0 in your sample" on a tumour slide. |
| New 6 | Notifications | The adjudication notice opens the wrong screen | fixed | Open goes to /tasks/{id}/adjudicate on T1 of Case queue 2. |
| New 7 | Tasks | RT-1 (Every state review) slide counts disagree | fixed | The sign-off window and the disagreements page both say 4 slides left. The task has 7 slides and each reviewer has 6, because Case ready is assigned to nobody. |
| New 8 | Evaluation | The comparison says both tasks cover the same slides | fixed | It says "RT-2 has 1 slides and RT-1 has 7, so the slide sets differ". "1 slides" is a new slip. |
| New 9 | Tasks | A task never started says Signed off and locked | partly fixed | The Signed off heading is gone. The banner still says "Only the people assigned to this task can do that" with nothing tried, Find nuclei is still offered, and the top bar says "about 0 min left". |
| New 10 | Viewer | A slide outside the task hangs | fixed | "This slide is not part of the task", with Open the task and Open the slide alone. |
| New 11 | Review | Read only notice with an empty name | fixed | "Nobody is assigned to this slide yet, so you can look but not answer." |
| New 12 | Review | Case ai-running says its objects are not there | fixed | The notice names the set "Tumour detector rerun" as still importing. |
| New 13 | Addresses | Unknown and misplaced slide addresses | fixed | An unknown slide is Page not found, after seven 404 calls. A slide under another project's id goes to its own project. |
| New 14 | Cases | The co-sign receiver sees the sender's page | fixed | The report address goes to the co-sign page. |
| New 15 | Adjudication | Finished adjudication reads as open | fixed | "0 objects need a decision out of 17, 2 resolved", and the row left To review. |
| New 16 | Search | The words are not kept in the address | fixed | /search?q=Showcase shows its three results. |
| New 17 | Viewer | Unknown mode and tab values | fixed | ?mode=banana and ?tab=nonsense are removed from the address. No notice is shown, and no sentence has a hole. |
| New 18 | Addresses | Natural addresses that are Page not found or blank | fixed | /projects goes home, /tasks/{id} opens the task's first slide, a case address goes to its report, and an annotate task says "Annotate tasks have no evaluation". |
| New 19 | Cases | Opening a report address sends a write | fixed | An unknown case is Page not found with two GET calls and no POST. |
| New 20 | Seed | The other workspaces have an empty clinical project | fixed | Machine Learning Lab and Medical Imaging Group each have 5 slides and 3 cases in their clinical project. A fresh sign-in still lands in Machine Learning Lab. |
| New 21 | Cases | The signed report prints empty headings | fixed | Received, Requested by and Clinical history are gone, and empty values say Not given. |
| New 22 | Wording | Wording slips | partly fixed | "Decide 1 object", "0 of 1 slide" and "1 disagreement not resolved" are right. New slips: "1 slides", "1 of 1 slides", "1 opinion forms", "1 runs going now". "about 0 min left" is still on one slide tasks. |

Round one also ranked five things that had no step of their own.

- Console and network noise is still there. Home, My work and the co-sign page ask for the thumbnail of Missing file.svs and get 404. The upload page asks for /api/uploads/open and gets 404. A patch export polls with 409 until it is done.
- The browser tab name is fixed for the project page, New case, the task wizard, co-sign and /setup. The new dataset page is plain "Parfocal".
- Dead ends in addresses are fixed. /sign-in goes home for a person who is signed in.
- A page stuck on Loading Parfocal during a rollout was not seen. A rollout to v0.34.2 happened during the walk and no page stayed on Loading.
- Wording and data slips are partly fixed, as New 22 says.

## The training data path, step by step

The owner's sentence is "upload a slide, annotate it by hand via one click things or whole slide stuff, have it human reviewed, and in the end produce annotations for AI training". The walk used a new project, the fixture slide CMU-1-Small-Region.svs, and where one account was not enough, the seeded tasks.

| # | Step | Where | Result | What happened |
|---|---|---|---|---|
| 1 | New project | /projects/new | works | P04 was created and the upload page opened. |
| 2 | Upload a slide | /projects/{id}/upload | works | Files, Check and Upload passed. The slide was listed 26 seconds after the upload button. It is named "Slide", see issue 14 (an uploaded slide is called Slide). |
| 3 | One click, Good | viewer, Annotate, S | works | A click on a nucleus gave an outline and Enter saved it. No server model was called. |
| 4 | One click, Best | viewer, Annotate, S, Best | works | "Waiting for a GPU" for 19 seconds, then the outline, saved with Enter. Two GPU calls for one click, see issue 20 (one Best click asks for the GPU twice). |
| 5 | Whole slide model, Find nuclei | viewer, Objects tab | broken | The run was queued and stayed on "0 of 0 tiles, 0 objects" for 17 minutes. See issue 4 (Find nuclei never started). |
| 6 | Whole slide model, Run a model | /projects/{id}/run-model | not walked | The window offers only the CAMELYON tumor model at about 4 minutes of GPU a slide. It was not started. |
| 7 | Add an AI result from a file | viewer, Display tab | works | cells.geojson showed 1,418 cells in cyan first and became the result set GeoJSON import in about 20 seconds. |
| 8 | Send hand drawn shapes to review | /projects/{id}/tasks/new | broken | A slide with no finished AI result is greyed out with the word "no". See issue 5 (hand drawn shapes cannot be reviewed). |
| 9 | New review task | /projects/{id}/tasks/new | works | Six steps, the agent account as the only reviewer, 200 random cells, 5-point certainty. Wording slips are in issue 16 (wording in the task wizard). |
| 10 | Decide objects in Guided | seeded RT-1 (Showcase case review) | works | K, X and U save. Reload keeps the answers. |
| 11 | Disagree with a reason | seeded RT-1 (Showcase case review) | works | The panel offers four reasons, a note, Redraw the outline and Change the type. |
| 12 | Redraw the outline | seeded RT-1 (Showcase case review) | works | Five clicks and Finish outline saved PUT /edits/T1. An Undo toast came. |
| 13 | Change the type | seeded RT-1 (Showcase case review) | works | Tumor, Stroma, Immune and Other are offered and Stroma saved. |
| 14 | Handles | seeded RT-1 (Showcase case review) | works | Enter opens "Move points". A dragged point saved as an edit. The entry is hidden, see issue 12 (handles and brush have no visible way in). |
| 15 | Brush | seeded RT-1 (Showcase case review) and the walk's task | works | Painting added, Shift erased, and each stroke saved. It also worked on a cell. |
| 16 | Restore the AI original | seeded RT-1 (Showcase case review) | works | DELETE /edits/T1 answered 204 and the button left the bar. |
| 17 | Object card history | Guided panel | works | "AI original, Tumor", four "Changed, new outline" lines with times, then "Back to the AI original". The card in Review was not read to its end. |
| 18 | Decisions in a 5-point certainty task | the walk's task | broken | Key 1 saved "Probably not, wrong class" and key 5 did nothing. See issue 7 (number keys in a certainty task). |
| 19 | Agree with the rest | the walk's task, cells mode | broken | 197 saves at once, most answered 500. See issue 1 (Agree with the rest fails). |
| 20 | Opinion and Submit | the walk's task | works | Submitted once the API answered again. A first try showed "Slide 1 submitted" on a 500, see issue 2 (a false Slide submitted). |
| 21 | Disagreement queue | /tasks/{id}/disagreements | works | Seeded and own queues list the objects, and a decision saves and leaves the count at 0. |
| 22 | Outline differs in the queue | /tasks/{id}/disagreements | not walked | No seeded object has two different outlines, and one account cannot make one. See issue 11 (gaps in the seed). |
| 23 | The adjudicator decides | /tasks/{id}/adjudicate | works | T1 of Case queue 2 was decided with Disagree, reviewers shown as A and B, and Ada was told. |
| 24 | The adjudicator picks or draws an outline | /tasks/{id}/adjudicate | not walked | The screen offered only Agree, Disagree and Not sure, because no reviewer had redrawn the object. |
| 25 | Edit myself from the queue | /tasks/{id}/disagreements | broken | The slide opens read only. See issue 6 (Edit myself opens read only). |
| 26 | Sign off with a fresh sign-in | /tasks/{id}/sign-off | works | Refused with 403 on an old sign-in and sent to the identity provider. Signed after a fresh sign-in by the script, with a checksum. |
| 27 | Final layer | /tasks/{id}/dataset | works | "Build 1: 198 agreed, 1 edited, 1 rejected, 0 added, 0 unsure and 0 open left out." |
| 28 | Dataset page with filters | /tasks/{id}/dataset | works | Origin, slide and unchecked filters and the counts are shown. Switching AI, agreed off left "1 object on 1 slide" and "198 by the filters". Classes show as IDs, see issue 9 (class IDs on the dataset page). |
| 29 | Freeze a version | /tasks/{id}/dataset | works | Version 1 with a note, who froze it, a SHA-256 and 16.3 KB. |
| 30 | Download the version, the training dataset zip | /tasks/{id}/dataset | works | parfocal-RT-1-dataset-v1.zip. Its contents are below. The Training dataset button of the sign-off window leads to this page. The Export entry "Training dataset (QuPath GeoJSON zip)" was tried only on the annotate task, where it refused in words because no slide is signed off. |
| 31 | Patches with masks and COCO | /tasks/{id}/dataset, Cut patches | broken | The zip downloads, but no object is in a mask or in COCO. See issue 3 (patches without labels) and issue 8 (a 575 MB patch export). |
| 32 | Dataset of an annotate task | seeded RT-6 (Annotation example) | not walked | Mark slide checked worked, but the slide could not be signed off. See issue 10 (no slide sign-off in an annotate task). |

### What is in the zips

Dataset version 1 of the walk's task RT-1 (GeoJSON import), 16.3 KB.

- manifest.json and one GeoJSON file for the slide. The SHA-256 in the manifest matches the file.
- 199 features: 198 with origin ai-confirmed and 1 with origin ai-edited. The page says the same, 198 agreed and 1 edited.
- The edited cell C601 has author A, changed_by A, source C601, versions 2 and differs_from_ai "shape". So the redrawn outline carries its author letter and the ID of the AI original.
- The rejected cell C653 is not in the file. The agreed cell C1358 is.
- Each feature has its class by name (Stroma 129, Immune 33, Other 32, Tumor 5).
- The manifest counts 1,218 unchecked objects left out, names the result set, and gives the annotator and the signer only as the letter A.
- No name, no email address and no "@" is in any file.
- No retyped object reached a zip. The retyped cell C653 was rejected in the queue, and RT-1 (Showcase case review), where T1 was retyped, is not signed off. So a changed type in a dataset was not seen.
- Wrong: "classes" is an empty list and every "class_key" is null, the preset says "annotate-by-hand" for a review task, and model_name and model_version are null for the imported set.

Dataset version 1 of RT-3 (Disagreement queue example), 1.8 KB. Two GeoJSON files with matching checksums, one feature (T1 of Case queue 1, ai-confirmed), and the rejected T1 of Case queue 2 absent. 15 of 17 objects are left out as not checked.

Patches of the walk's task, 6 MB. 30 tiles and 30 masks of 512 pixels, index.csv, manifest.json, annotations.json and the slide's GeoJSON. Every tile has its mask. annotations.json lists 30 images, 0 annotations and no category. The manifest says "unclassed_left_out": 199, so all 199 objects were dropped and the masks are blank.

Patches of RT-3 (Disagreement queue example), 575 MB. 1,115 tiles and 1,115 masks for one object, 0 annotations and no category.

## New issues

Ranked by how much each blocks the path from a slide to training data.

### 1. Agree with the rest fails for most cells and makes the API answer 500

- Severity is high.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=cells`.
- Steps. Open a review task with 200 sampled cells in cells mode. Press Shift+K, then Enter on "Agree with 197".
- What happened. The page sent one PUT /decisions call for each cell at the same moment. At about 03:21 the first round saved 44 of 197 and the rest answered 500. On v0.34.2 a fresh task saved 80 and 120 answered 500, so the release change is not the cause. The grid stayed on a partial count, and the only notice was "Something went wrong on our side. Try again in a moment." For about a minute after each round other calls of the same session answered 500 too: /api/me, /api/me/home, the task, tile-access and the submit. It took six rounds to reach 200 of 200. Other people on the deployed app may have been hit in that minute, which was not checked.
- What should happen. One request for the whole batch, or a few at a time, and a notice that says how many cells were not saved.

### 2. "Slide 1 submitted" is shown when the submit call failed

- Severity is high.
- Route is `/projects/{id}/slides/{id}?task={id}`.
- Steps. Press Submit while the API answers 500, as it did after issue 1 (Agree with the rest fails).
- What happened. POST /submit answered 500 and the window said "Slide 1 submitted, Back to My work". My work then said 0 of 1 slide and the sign-off window said "Agent Tester has 1 slide left". A second Submit some minutes later answered 200. In the same minutes other screens showed empty data as if it were true: My work said "Assigned by me 0" and "All slides 0", the Objects tab said "Nothing measured yet" on a slide with two saved outlines, and the task opened as a plain viewer with no mode switch and no Submit.
- What should happen. The window shows only after the server confirms, and a failed submit says so and stays on the slide.

### 3. Patches with masks and COCO from a review task hold no labels

- Severity is high.
- Route is `/tasks/{id}/dataset`, Cut patches.
- Steps. Sign off a review task, freeze a version, Cut patches with Masks and COCO, level 0, tile 512.
- What happened. The zip has every tile and a mask for each, but annotations.json has 0 annotations and no category, and the manifest says "classes": [] and "unclassed_left_out": 199 of 199 objects. The same happened for the seeded RT-3 (Disagreement queue example), 1 of 1. The GeoJSON in the same zip has each object with its class name, so the class is known but has no class key.
- What should happen. The class snapshot of a review task goes into the final layer, so masks and COCO carry the 199 objects with four categories.

### 4. Find nuclei on the whole slide never started

- Severity is high.
- Route is `/projects/{id}/slides/{id}?tab=objects`.
- Steps. On the uploaded slide click Find nuclei with scope Whole slide.
- What happened. POST /model-runs answered 201 and the run (HoVer-Net v0.9) stayed queued with 0 attempts for at least 17 minutes, until it was cancelled. The panel said "0 of 0 tiles, 0 objects" and Cancel run the whole time, with no word about a queue or a GPU wait. Admin said "1 runs going now". Cancel run worked. The Run a model window offers only the CAMELYON tumor model, so there was no other way to get cells from a model.
- What should happen. The run starts, or the panel says where it waits and for how long, as Best in Smart select now does.

### 5. Shapes drawn by hand cannot be sent to review, and the wizard does not say why

- Severity is medium.
- Route is `/projects/{id}/tasks/new`, Slides, Add slides.
- Steps. Upload a slide, draw or smart select some outlines, start New review task, Review AI results, Add slides.
- What happened. The slide is greyed out and cannot be ticked. The only text next to it is "no". The picker heading says "from P07" in project P04. Once a result file was added, the slide was picked by itself. Hand drawn outlines are listed as measurements and no task kind sends them to a second person for decisions.
- What should happen. The row says "No AI result yet" with a way to add one, and the owner decides whether hand drawn objects can be reviewed like AI objects.

### 6. "Edit T1 myself in the viewer" opens the slide read only

- Severity is medium.
- Route is `/tasks/{id}/disagreements`.
- Steps. As the task owner pick an open object in the queue and click Edit T1 myself in the viewer.
- What happened. The viewer opens on T1 with "Read only. This slide is assigned to Rhea Reviewer and Remy Reviewer, so you can look but not answer." Nothing can be drawn or changed, and there is no way back into the decision.
- What should happen. The owner can redraw or retype the object there and the result is stored as the settled outline, or the button is not offered.

### 7. In a 5-point certainty task the number keys pick a class instead

- Severity is medium.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=guided`.
- Steps. Open a cell task with the 5-point certainty question. Press 5, then 1, then X.
- What happened. The panel shows "Certainly not 1" to "Certainly 5". A bar on the slide shows "K Agree, 1 Tumor, 2 Stroma, 3 Immune, 4 Other, X Disagree". Key 5 did nothing. Key 1 saved the answer 2, "Probably not", with the reason wrong class and the class Tumor. X saved a disagree and moved on with no Redraw the outline or Change the type offered. Preferences, Shortcuts says 1 to 5 belong to 5-point certainty.
- What should happen. One meaning for each key in a style, and the same fix options after a low answer as after Disagree.

### 8. A patch export of one object writes 575 MB and floods the console

- Severity is medium.
- Route is `/tasks/{id}/dataset`, Cut patches.
- Steps. On version 1 of RT-3 (Disagreement queue example), which holds one object on two slides, Cut patches at level 0 and tile 512.
- What happened. The job took 240 seconds and downloaded 575 MB: 1,115 tiles that cover both slides whole, 1,085 of them from the slide that has no object. The page showed no progress that was read, polled the job with a call that answered 409 each time, 110 console errors in all, and one call answered 500.
- What should happen. Tiles only where objects are, or a size estimate and a choice before the job starts, and a poll that answers 200 with a state.

### 9. The dataset page shows class IDs, and the manifest has no class snapshot

- Severity is medium.
- Route is `/tasks/{id}/dataset`.
- Steps. Open the dataset page of a signed off review task.
- What happened. By class lists "1722eef1 129, 449a53e5 5, c68c36c6 32, df8b69b2 33" and, on the seeded tasks, "77c84704 1". The manifest has "classes": [] and the features have "class_key": null. This is the cause of issue 3 (patches without labels).
- What should happen. Class names on the page and a class snapshot with keys in the manifest.

### 10. An annotate task shows no way to sign its slide off

- Severity is medium.
- Route is `/projects/{gallery}/slides/{id}?task={id}&mode=annotate`, then `/tasks/{id}/dataset`.
- Steps. Open RT-6 (Annotation example), click Mark slide checked, open the dataset page.
- What happened. The panel says "1 of 1 slide checked" and the top bar keeps only Export. The dataset page says "No slide of this task is signed off yet". The task's sign-off window says each slide is signed off "in the viewer, under Objects, once its experts have checked it". The whole Objects panel was read and it has no sign-off control and no line about who still has to check. The API shows the second expert, the workspace owner account, has not checked, so no agent account can finish this task.
- What should happen. The panel names who still has to check and shows the sign-off button when it can be used. The seed gives the agent account an annotate task it can finish alone.

### 11. The seed has no outline that differs, and its reviewers left most objects open

- Severity is medium.
- Route is `/tasks/{id}/disagreements, /tasks/{id}/adjudicate, /tasks/{id}/dataset`.
- Steps. Read every seeded queue. Sign off RT-3 (Disagreement queue example) and open its dataset.
- What happened. No queue has an object marked "outline differs", so that state and the adjudicator's Use this outline could not be seen. The seeded reviewers of RT-3 (Disagreement queue example) and RT-2 (Signed-off review) decided only 2 of 17 and 1 of 11 objects, yet the sign-off window says "All 2 slides reviewed by both reviewers". The datasets then hold one object each and leave 15 and 10 out as not checked, with no warning before signing.
- What should happen. One seeded object where two reviewers drew different outlines and the agent account adjudicates, seeded reviews that decide every object, and a line in the sign-off window that counts objects nobody decided.

### 12. Handles and brush have no visible way in

- Severity is medium.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=guided`.
- Steps. Pick an object in Guided and look for a way to move its points.
- What happened. Move points and Brush open only with Enter or a double click on the object, and nothing on the screen says so. Enter does nothing right after a click on the object's chip, because the chip has the focus. On an object that is already decided, Redraw the outline and Change the type come back only after pressing Disagree again, and that press removed the saved reason.
- What should happen. An Edit outline button on the object card, and the fix options kept open on a decided object.

### 13. After a reload Guided has no way to the opinion questions

- Severity is low.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=guided`.
- Steps. Decide every object, reload before answering the opinion.
- What happened. Guided opens on object 1 of 6 again. Submit is off and nothing in Guided leads to the opinion questions. They are in Review, tab Opinion.
- What should happen. Guided opens on the first thing still open, here the opinion.

### 14. An uploaded slide is called "Slide"

- Severity is low.
- Route is `/projects/{id}/upload`, then the viewer.
- Steps. Upload CMU-1-Small-Region.svs into a de-identified project.
- What happened. The slide is "Slide" in the picker, the task, the queue and the dataset path (P04/~/Slide/C601), and the tab is "Slide · Slide · Parfocal". Two uploads would have the same name.
- What should happen. A name that tells slides apart without patient data, such as a number or a cleaned file name.

### 15. A fresh sign-in by the script still lands in Machine Learning Lab

- Severity is low.
- Route is `/api/auth/sign-in`.
- Steps. Run scripts/agent_session.py and read /api/me.
- What happened. The first sign-in opened in Machine Learning Lab. Later sign-ins kept Biomedical Engineering.
- What should happen. The agent account's first session opens in the workspace its tasks are in.

### 16. Wording in the task wizard

- Severity is low.
- Route is `/projects/{id}/tasks/new`.
- Steps. Walk the six steps.
- What happened. "from P07" in P04. "HoVer-Net v0.9 v0.9". A run that is still queued is offered as an AI result "on 0 of 1". "1 slide with GeoJSON in this task". The task name is filled with the result set's name, GeoJSON import. "1 of 1 slides". Review AI results is described as "without drawing", though reviewers can now redraw.
- What should happen. The real project code, one version, only finished results, and text that matches what reviewers can do.

### 17. A task with one reviewer speaks of both reviewers

- Severity is low.
- Route is `/tasks/{id}/disagreements, /tasks/{id}/sign-off`.
- Steps. Make a task with one reviewer, submit, open both pages.
- What happened. The queue marks the objects "both vs AI". The sign-off window says "The slide was reviewed by both reviewers" and "1 of 1 reviews submitted, 1 opinion forms".
- What should happen. "the reviewer vs AI" and singular forms.

### 18. A queued run of another result set shows inside the review

- Severity is low.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=guided`.
- Steps. Review a task on a slide that also has a queued model run.
- What happened. The banner says "The result set HoVer-Net v0.9 v0.9 is still importing" and the panel shows "Still reading this slide, 0 regions so far" with Tissue found, Tumor regions and Cells all queued, under the question about a cell of another result set.
- What should happen. A review task shows only the state of the result set it checks.

### 19. Small things on the dataset page

- Severity is low.
- Route is `/tasks/{id}/dataset`.
- Steps. Open it for a signed off task, a review task that is not signed off and an annotate task.
- What happened. The tab name is "Parfocal". Dates read "Nov 21, 2026, 2:47 AM" while the rest of the app writes "21 Nov 2026, 02:47". A review task that is not signed off says "Sign off at least one slide", though a review task is signed off as a whole, and still offers Build the final layer. The page asks /dataset and gets 409.
- What should happen. A tab name, one date form, and text for the kind of task.

### 20. One Best click asks for the GPU twice

- Severity is low.
- Route is `/projects/{id}/slides/{id}`.
- Steps. Smart select, Best, one click.
- What happened. Two POST /embeddings/view calls left within a second and both answered 200 after the wait. Round two saw the same.
- What should happen. One call for one click.

## Do the viewer tabs and tools fit the task

- Look has Select, Pan, Measure, Comment, Smart select and Compare with Objects, Display and Comments. Annotate with no task has the full rail. Both fit. Outlines from Smart select on nuclei are still listed under Measurements and Tumor.
- Guided has Review, Comments and Display and now Submit, which fits. The Edit history under the answers fits. The way into handles and brush is hidden.
- Review has Objects, Display, Comments and Opinion, which fits. Annotate on a review task has the full rail and Export, which fits.
- Cells mode opens and its grid fits the task. The mode switch does not show that cells mode is on. In a certainty task the bar on the slide and the panel disagree about the number keys.
- Annotate on an annotate task has Export with the training dataset, the patches and the dataset page, which fits. Sign-off of the slide is missing from view.
- The adjudication screen has Review and Display and the anonymous reviewers, which fits. It has no outline tools.

## Going wide

| Area | Step | Result | What happened |
|---|---|---|---|
| Home | Open home | works | Welcome, start cards, four projects, the resume card. One 404 for a thumbnail. |
| My work | To review, Assigned by me | works | Tasks, the adjudication row and the co-sign ask. 16 tasks assigned by me. |
| Notifications | List and Open | works | Four notices, and Open on the adjudication one reaches the right screen. |
| Search | /search?q=Showcase | works | Three cases after a reload. |
| Palette | ⌘K, "developer" | works | Developer mode is listed with its key, and Enter opens /developer, which names the drawer and the projects. This is PROTO-108 (the developer drawer from the palette for researchers). The drawer over a slide was not opened. |
| Preferences | /settings | works | Nine sections. No picture was found in Display, Shortcuts or Notifications. No section is named Tools, so PROTO-123 (settings pictures only for Tools) could not be confirmed. |
| Team | /team | works | 13 open tasks and 2 done. |
| Admin | /admin | works | Overview with people, models and storage. "1 runs going now". |
| Timing and study | /kpi, /study | works | Both open inside the app. |
| Evaluation | RT-2 (Signed-off review), compare | works | The comparison block states that the slide sets differ. |
| Evaluation | RT-3 (Disagreement queue example), ?view=pdf | works | The signed report opens. |
| Cases | Signed report and co-sign page | works | Empty headings are gone, and the receiver lands on the co-sign page. |
| Jobs | Tray | works | One finished upload with Open. |
| Viewer modes | Look and Annotate with no task, Guided, Review, Annotate and cells on a review task, Annotate on an annotate task, the adjudication screen | works | Each opened with the tools and tabs listed in the section above, read only where the account is not assigned. The compare layout kept its address, but two panes were not confirmed. |
| Odd addresses | Nine of them | works | All answer with a page or a redirect, as the recheck table lists. |
| Reload and back | In Guided | works | Answers and edits are kept after a reload. Browser back from My work returns to the guided slide and forward goes to My work again. |
| Lock | PROTO-124 (lock after 240 minutes) | not walked | The walk was shorter than 240 minutes. |
| Viewer feel | The viewer fixes for cells slide lag, the overview map corner, floating zones and tile loading, and PROTO-105 (readable text labels) | not walked | Cell slides opened and listed their objects, but nothing was timed and no label was looked at. |
| Signed out | The dataset address and a made up share link | works | The dataset address goes to /sign-in with the address kept in return_to. The made up link says "This link does not lead to a report". |

The scripts used are in the session scratchpad and are not in the repository. Keeping one in the repository, which TEST-056 (the deployed walkthrough) asks for, is still TODO.
