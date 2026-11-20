# The path from an uploaded slide to human reviewed training annotations

- Date: 2026-11-20
- Asked by the owner: "we should allow the reviewer and doctor to edit the annotation generated like shape of it and have it recorded, we have to have a way to upload a slide annotate it by hand via one click things or whole slide stuff have it human reviewed and in the end produce annotations for ai training".
- Method: read from the code, the ADRs and the board of the lead checkout on 2026-11-20. Nothing was changed and nothing was measured. The deployed app was not opened, because another agent was fixing a lag on the slide the owner pointed at. Every "on screen" claim below is a claim about the web code, not about a click.
- A picture of the path, today and proposed, is in [2026-11-20-annotate-review-export-path.html](2026-11-20-annotate-review-export-path.html).

## Short answer

Almost every piece of the path already exists in the API. The path does not hold together because it is built twice, on two kinds of task that do not meet.

| | Review task | Annotate task |
| --- | --- | --- |
| Rule | ADR 0078 (the review task model) and ADR 0079 (the reviewed layer) | ADR 0237 (annotate tasks on one shared layer) |
| Who works | Each reviewer alone, hidden from the others | Every assigned expert on one shared layer |
| Decisions (agree, disagree, unsure) | Yes | No, an AI object is confirmed, edited or deleted |
| Shape edits | One row per reviewer and object in `review_edits`. A save replaces the row | A copy in `annotations` with every version kept in `annotation_versions` |
| Disagreements and adjudication | Yes | No, by design |
| Sign off | The whole task | Each slide |
| Training export | None. Only a per reviewer or consensus file with no button | QuPath GeoJSON zip and patches with masks, with no button |

The deployed task the owner opened is a review task. It "almost does it" because it has the decisions, the queue and the adjudicator, but its shape editing is not wired in the live viewer, its edits keep no history, and it has no way out into a training dataset. The annotate task has the recorded edits and the dataset, but no independent review and no adjudication.

## The five biggest gaps

1. A review task cannot produce a training dataset. `training_exports.py` and `patch_exports.py` both call `annotate_only`, so they refuse a review task. The only review output is `GET /api/review-tasks/{task_id}/slides/{slide_id}/export` in `reviewed_export.py` (one reviewer's layer or the consensus), which has no caller in the web app.
2. A reviewer cannot edit a shape in the live viewer. `apps/web/src/viewer/stage-guided-card.tsx` passes `disagreeOpen={false}` and an empty `onFix`, so "Redraw the outline" and "Change the type" never show. The redraw works only in `apps/web/src/screens/review/guided-review.tsx`, which the guided route shows only when the address carries a scene, and which the submitted screen reuses. Split and merge have API routes and no caller at all.
3. A review edit is not fully recorded. `review_edits` holds one row per task, slide, reviewer and object, a save replaces it, and the audit entry `review.object-edited` stores only the words retyped, reshaped or deleted. The AI original stays recoverable because the result set is never rewritten, but the steps in between and the geometry before and after are lost.
4. Adjudication settles an answer, not a shape. `disagreement_decisions` has an answer and a class and no geometry. When two reviewers redraw the same region differently, the consensus export takes the earliest redraw, and it covers agreed regions and added objects only, not AI cells.
5. The dataset has no home on screen and no version. The zip of QuPath GeoJSON (ADR 0262) and the patches with masks (ADR 0299) exist as routes with a manifest and checksums, but the web app calls neither. There are no filters, no stored dataset version, no model name or version in the manifest, and no COCO.

## Step 1. Upload a slide or a batch into a project

Exists today.

- Resumable multipart upload: `apps/api/src/parfocal_api/uploads.py` (`/api/uploads/open`, parts, `complete`) and `project_uploads.py` (`/imports`, `/upload-batch`). Built by INGEST-001 (upload API with presigned multipart), INGEST-002 (upload UI with resume), INGEST-021 (upload wizard with slides and results), INGEST-024 (upload progress with steps per slide), PROTO-084 (upload warns about duplicates, unmatched files and full storage).
- The wizard in `apps/web/src/screens/upload/` sorts dropped files, pairs result files with slides, and its done step offers "Run a model".
- Existing annotations come in through `annotate_import.py` (`/imports`) and ANN-023 (import GeoJSON and own JSON).

Missing or broken.

- The done step does not offer "start an annotate task with these slides". A person has to know to go to the new task stepper.
- The deployed walkthrough of 2026-11-20 found that a finished job in the Jobs tray opened an empty wizard. PROTO-101 (every link and page from the walkthrough reaches its screen) is ticked for it. Not rechecked here.

Ways to cover it.

- A. Leave upload as it is and add one link on the done step, "Annotate these slides", that opens the annotate task stepper with the batch chosen. Small, and it makes the path visible.
- B. A single "new dataset" wizard that uploads, runs a model and creates the task in one flow. Clearer for a first user, but it repeats three wizards that already work.

Recommendation: A.

## Step 2. Annotate by hand, with one click tools and with whole slide models

Exists today.

- Hand tools in `apps/web/src/annotations/`: polygon, freehand, rectangle, ellipse, count marker, brush with paint and erase (`brush.ts` uses union and difference), select with point handles (`reshape.ts`, ANN-035, Figma style point editing), undo, autosave with stale save refusal (ANN-022, concurrent edit protection).
- One click tools: Smart select with Good and Best (AISEG-005, smart select tool, and AISEG-024, Best outlines on the server, in review), auto region, proposals that are accepted or dropped (ADR 0255, smart select gestures and proposals), typing of accepted cells (AINUC-014).
- Whole slide models: `model_runs.py` (`POST /api/projects/{id}/model-runs` with scope slide, view or selection), `tumor_maps.py` (`POST .../slides/{id}/tumor-maps`), streaming onto the open slide (AINUC-013), the Whole slide button and the run window (`start-run-panel.tsx`, `screens/jobs/run-model-window.tsx`).
- In an annotate task every saved shape is a row of `annotations` with origin `human`, `ai-edited` or `ai-confirmed`, a source number for a copied AI object, and one `annotation_versions` row per change with the geometry, the class, who and when.

Missing or broken.

- Shapes drawn in the Annotate mode of a review task do not belong to the task. `slide-stage.tsx` sets `sharedTaskId` only for a task of kind annotate, so `use-saved-annotations.ts` falls back to `annotationTransport(slideId)`, the slide wide layer. They reach neither the reviewer's layer nor any dataset.
- No split and no merge of drawn shapes on screen. Erase part exists only as the brush.
- PROTO-073 (guided steps and Smart select stay in sensible bounds) is waiting, and AISEG-024 (Best outlines on the server) is in review, so Best is not proven on the deployed app yet.

Ways to cover it.

- A. Keep the tools as they are and fix only where the shapes land (see step 3 and the first owner question).
- B. Add split by a drawn line and merge of selected shapes to the Select tool for every layer, as client geometry that saves through the routes that exist. One place to learn, used by both kinds of task.

Recommendation: both. A is part of the task model choice. B is one medium task after the editing in review works.

## Step 3. A reviewer or doctor goes through the AI objects, decides and edits the shape

Exists today.

- Decisions: `review_decisions.py` and `review_decisions` (ADR 0072, decisions, reasons and opinion forms, and ADR 0300, the review decisions table), with reasons such as boundary off, two regions and wrong class in `apps/web/src/screens/review/disagree-reasons.ts`.
- Review edits in the API, `reviewed_layer.py`: `PUT` and `DELETE .../edits/{object_id}` (retype, reshape, delete, undo), `POST .../edits/{object_id}/split`, `POST .../merges`, `POST .../added`, `GET .../layer`. Built by RSET-007 (the reviewed layer) and OBJ-003 (split, merge and added objects). The AI result set is never rewritten, and tests prove it.
- In an annotate task: confirm, edit, delete and undo of any AI object through `annotate_layer.py` and the batch route `POST .../shared-layer/ai-changes` (ADR 0401, AI cell edits as one atomic batch), with handles, class keys and lasso on the slide (PROTO-035, experts edit any imported or seeded cell, and PROTO-067, AI objects can be confirmed, deleted and undone). History per object is served by `GET .../objects/{id}/history` and shown through `annotations/provenance.ts` (ANN-028, annotation audit and provenance display).

Missing or broken.

- In the live viewer a reviewer of a review task can only decide. The fix buttons are dead, as gap 2 says. `useSaveReviewEdit` is used only by the old guided screen.
- Review edits keep no history and no before and after geometry, as gap 3 says.
- Split and merge have no caller in the web app.
- A review edit records the reviewer and the time. The model name and version sit on `result_sets.model_version` and are not copied next to the edit, which is fine as long as the export joins them.
- "Doctor" is not a separate case in the code. A clinical reviewer works through the same review task, so whatever is built for the reviewer covers the doctor.

Ways to cover it.

- A. Wire the review routes that exist into the live viewer. The disagree card opens its reasons, "Redraw the outline" and "Change the type" save to `review_edits`, the Select tool gets handles on the current AI object, and split and merge call their routes. Add an append only `review_edit_versions` table with who, when, the change and the geometry and class after it, so before and after can be read from two rows. Keeps independent reviewers and the disagreement queue. Costs one migration that only adds, and a second editing code path beside the annotate one.
- B. Stop editing in review tasks. A reviewer who disagrees with a shape is sent to an annotate task for the same slide, where editing and history already work. No new storage, but the reviewer leaves the flow, two reviewers edit one shared shape, and there is nothing to adjudicate.
- C. Move review edits into `annotations` as a private layer per reviewer, so one table and one history serve both tasks. Cleanest in the end, but it rewrites the reviewed layer, the disagreement rule and three exports.

Recommendation: A. It reuses the routes and the tests that exist, it keeps what makes a review a review, and the added table is small. Reuse the annotate handles and the brush on screen so there is one way to edit a shape.

## Step 4. Disagreements between reviewers are adjudicated

Exists today.

- The rule and the queue: `disagreements.py`, `disagreement_queue.py`, `disagreement_decisions` (ADR 0080, the disagreement rule and sign off, ADR 0133, queue decisions and anonymous adjudicators, ADR 0228, look again reopens decisions).
- Sending to an adjudicator and deciding: `adjudications.py`, `adjudications`, `adjudication_objects`, the screens in `apps/web/src/screens/disagreements/` (ADJ-003, adjudicator view, ADJ-008, send to an adjudicator, PROTO-078, disagreements draw the slide and adjudication works for real, PROTO-103, adjudication works on the seed).
- A redraw made after the decisions is noticed: `edited_after_decisions` and `edits_settled_at` let the owner ask the reviewers to look again or keep their decisions.

Missing or broken.

- Two reviewers who both agree on the class and redraw the outline differently are not a disagreement, and nobody chooses between the outlines.
- The adjudicator cannot pick or draw the final shape. The decision row has no geometry.
- An annotate task has no adjudication at all. With "blind first" on (COLLAB-017, the blind first switch) experts work unseen for a while, but nothing compares their shapes afterwards.

Ways to cover it.

- A. The adjudicator settles the shape too. A shape disagreement rule adds an object to the queue when reviewers' outlines overlap less than a set share. The card draws each reviewer's outline over the AI one, and the adjudicator picks one or draws a new one, saved as geometry on the queue decision. Precise, and every final shape has a named human source. Needs a threshold the owner has to set.
- B. Merge shapes by rule with no person: the union, the intersection or a majority area. No extra work for anyone, but a shape nobody drew goes into training data.
- C. Do not compare shapes. The latest edit wins. Cheapest, and it hides real disagreement.

Recommendation: A, with the threshold as an owner question.

## Step 5. An export of human reviewed annotations for AI training

Exists today.

- One slide, any layer: `annotation_exports.py`, GeoJSON, FlatGeobuf and Parfocal JSON, with a menu in the app (`slide-export-menu.tsx`, ANN-024, export GeoJSON, FlatGeobuf and own JSON, and PROTO-088, an annotate task offers its exports).
- Annotate task dataset: `GET /api/review-tasks/{id}/training-dataset` in `training_exports.py` (EVAL-014, training dataset export, ADR 0262). A zip of QuPath GeoJSON per signed off slide. Each feature carries the object ID, kind, origin, class, source AI object and author letters. The manifest carries the class snapshot, the check options, the annotators as letters, the sign off, counts by origin and a SHA-256 per file.
- Patches with masks: `POST` and `GET /api/review-tasks/{id}/patch-exports` in `patch_exports.py` (EVAL-015, patch and mask export, ADR 0299). RGB tiles, 8 bit class masks, `index.csv` and a manifest.
- Review task: `reviewed_export.py` (RSET-008, export reviewed annotations) gives one reviewer's layer or the consensus as GeoJSON or a class CSV. `evaluation_exports.py` (EVAL-003, exports, ADR 0231) gives the evaluation with a checksum.
- Model loop: `training_examples.py`, `reviewed_nuclei.py` and `validation_split.py` already feed reviewed nuclei to the tenant training rounds (AILEARN-004, server training rounds, AILEARN-010, pooled features of reviewed nuclei).

Missing or broken.

- No button for the dataset zip or the patch export. The web app calls neither route.
- A review task has no training dataset, as gap 1 says.
- No filters beyond "include unchecked objects". A researcher cannot ask for only agreed, only edited or only one class.
- No dataset version. `FORMAT_VERSION` is the version of the file format. Two downloads of the same task a day apart can differ and nothing records which one trained a model.
- The manifest names the result set by ID and carries no model name and no model version.
- No COCO. No instance mask format. QuPath is covered by the GeoJSON.

Ways to cover it.

- A. One final layer, one dataset builder. A signed off review task is turned into a final layer in the shape the annotate export already reads: an agreed object becomes an `ai-confirmed` copy, a redrawn or retyped one an `ai-edited` copy with the reviewer as author, an adjudicated one takes the adjudicator's outcome, a rejected one is a deletion. Then the zip, the masks and any new format work for both kinds of task. One export code path and full history. Costs a conversion step and an ADR on where the final layer lives.
- B. A second reader. Teach `training_exports.py` to read a review task's consensus directly. No conversion, but two readers must stay in step for every new format and filter, and review edits have no history to export.
- C. Only annotate tasks make training data. The owner's flow becomes "review to measure the model, annotate to make data". Nothing to build except buttons, but the doctor's corrections in a review are thrown away as training signal.

Recommendation: A, after the cheap wins. First give the routes that exist their buttons. Then add a dataset page on the task with filters and a stored version. Then the final layer for review tasks. Add COCO as a format of the patch export when the owner confirms it is wanted.

## Recommended order

1. Buttons for what exists: the dataset zip and the patch export on an annotate task. The path is then complete for annotate tasks on the deployed app.
2. Editing in the live review: reasons card, redraw, retype, handles.
3. History for review edits.
4. Model name and version, edit counts and filters in the export, with a stored dataset version.
5. Shape disagreements and the adjudicator's outline.
6. The final layer that lets a review task feed the same dataset builder.
7. Split and merge on screen, COCO, and one end to end spec over the whole path.

Steps 1, 2 and 3 need no owner answer. The stored version in step 4 waits for question D, step 5 for question B and step 6 for question A below.

## Proposed backlog tasks

In order. No IDs are given, the lead assigns them.

1. An annotate task offers its training dataset and its patches in the app.
   Why: the routes of EVAL-014 (training dataset export) and EVAL-015 (patch and mask export) have no caller, so the end product of the path cannot be reached from the screen.
   Done when the Export menu of an annotate task lists "Training dataset (QuPath GeoJSON zip)" and "Patches with masks", each with one line on what it holds, the patch export asks for the level and tile size and shows its job, `nothing-signed-off` is explained in words, and a spec downloads both on the fake API and one on the real API.
   Depends on PROTO-088 (an annotate task offers its exports in the app). Size: S.

2. The upload done step offers to annotate the uploaded slides.
   Why: after a batch upload the next step of the path is not shown.
   Done when the done step has "Annotate these slides" beside "Run a model", it opens the annotate task stepper with the batch chosen, and a spec covers it.
   Depends on PROTO-064 (an annotate task can be created from its stepper). Size: S.

3. A reviewer fixes an AI object from the live review card.
   Why: `stage-guided-card.tsx` never opens the reasons and its fix buttons do nothing, so the redraw and retype of RSET-007 (the reviewed layer) are unreachable in the viewer people use.
   Done when Disagree opens the reasons in the live viewer, "Redraw the outline" and "Change the type" save through `saveReviewEdit`, the redrawn outline is drawn over the dimmed AI one, Undo clears the edit, a read only reviewer sees no fix buttons, and specs cover a region and a cell on the fake API and one on the real API.
   Depends on PROTO-099 (one progress control, one Submit and engine drawn adjudication). Size: M.

4. A reviewer edits the current AI outline with handles and the brush.
   Why: the owner asked for moving vertices and erasing part, and a full redraw is too coarse for a small fix.
   Done when Enter or a double click on the current AI object in a review task shows the same handles as Annotate, the brush adds to or erases from it, each gesture saves one review edit, "Restore the AI original" clears it, and specs cover move, add, erase and restore.
   Depends on task 3. Size: M.

5. Every review edit keeps its history.
   Why: a save replaces the `review_edits` row and the audit entry has no geometry, so who changed what and from which shape cannot be shown or exported.
   Done when a migration that only adds creates an append only version table with the task, slide, reviewer, object, change kind, class and geometry after the change and the time, every save, clear, split and merge writes one row, `GET .../edits/{object_id}/history` returns them with the AI original first, the object card shows the list, and DB tests prove the rows cannot be updated or deleted by the app role. An ADR records the choice.
   Depends on nothing. Size: M.

6. The training dataset names the model and counts the edits.
   Why: provenance in the manifest stops at a result set ID.
   Done when each slide in the manifest carries the result set name, model name, model version and source, each feature carries the number of versions and whether its shape, its class or both differ from the AI object, the format version is raised, and the strict model and its tests are updated.
   Depends on nothing. Size: S.

7. A dataset page with filters and stored versions.
   Why: a researcher needs "only agreed", "only edited", one class or some slides, and needs to say later exactly which data trained a model.
   Done when a task has a Dataset page that shows counts by origin and class for the signed off slides, filters by origin, class, slide and "include unchecked" change the counts, "Freeze a version" stores the manifest and the GeoJSON files as write once objects with a number, a note, the filters, who and when and a checksum, the list of versions downloads any of them again byte for byte, patches are made on demand from a frozen version, and API and browser tests cover it. An ADR records the storage and the cost per version.
   Depends on tasks 1 and 6 and on owner question D. Size: L.

8. Reviewers' outlines that differ reach the disagreement queue.
   Why: two different redraws of one object are not noticed today.
   Done when the disagreement rule adds an object whose reviewers' outlines overlap less than the task's threshold, the queue card says "outline differs" and draws each outline in its own colour over the AI one, and DB tests cover equal, close and far outlines for regions and cells.
   Depends on task 5 and on owner question B. Size: M.

9. The adjudicator settles the shape.
   Why: the queue decision stores an answer and a class and no geometry.
   Done when the adjudicator and the owner in the queue can pick one reviewer's outline or draw a new one, it is stored on the decision with who and when, the consensus export uses it and covers cells, and specs cover pick, draw and undo.
   Depends on task 8. Size: M.

10. A signed off review task becomes a final layer the dataset builder reads.
    Why: `annotate_only` shuts review tasks out of the training export, so a doctor's corrections never reach a dataset.
    Done when signing off a review task, or a button on its Dataset page, builds the final layer by the rule of the chosen option (agreed objects as `ai-confirmed`, edited ones as `ai-edited` with their author, adjudicated ones with the adjudicator's outcome, rejected ones as deletions, added ones as `human`), the training dataset and the patch export accept the task, an object left open or unsure is left out and counted, and tests compare the export with the decisions and edits it came from. An ADR records where the final layer lives.
    Depends on tasks 5 and 9 and on owner question A. Size: L.

11. Shapes drawn in a review task's Annotate mode belong to the task.
    Why: they are saved to the slide wide layer today, so they are in no reviewer's layer and no dataset.
    Done when a shape drawn by an assigned reviewer in a review task is saved with the task, shows as an added object with its person mark in the reviewer's layer and the consensus, stays hidden from other reviewers while blinding holds, and specs cover it.
    Depends on owner question A. Size: M.

12. Split and merge on screen.
    Why: OBJ-003 (split, merge and added objects) built the routes and nothing calls them, and Annotate has neither.
    Done when the Select tool splits a selected shape along a drawn line and merges two or more selected shapes, in a review task through the split and merge routes and in an annotate task as one atomic batch that keeps the source numbers, undo restores the original, and specs cover both kinds of task.
    Depends on tasks 4 and 5. Size: L.

13. COCO as a format of the patch export.
    Why: the owner named COCO and most detection and instance segmentation trainers read it.
    Done when the patch export can write `annotations.json` in COCO form beside the tiles, with categories from the class snapshot, one polygon per object clipped to its tile and the Parfocal object ID and origin in each annotation, and a test loads it with `pycocotools` and compares areas with the masks.
    Depends on task 7 and on owner question C. Size: M.

14. One spec walks the whole path on the real API.
    Why: the owner's sentence is one flow and nothing proves it end to end.
    Done when an end to end spec uploads a small slide, runs cell detection on a selection, has two reviewers decide and one redraw an outline, adjudicates one disagreement, signs off, freezes a dataset version and checks that the zip holds the redrawn outline with its author letter and the AI original's ID.
    Depends on tasks 3, 7, 9 and 10. Size: M.

## Questions for the owner

For the lead to copy into `docs/decisions.md`.

### A. Which task carries training data from reviewed AI objects?

Review tasks have independent reviewers, decisions and adjudication, and no training export. Annotate tasks have one shared layer with full history and the training export, and no adjudication.

- A. Both, joined at the end. A signed off review task is turned into a final layer that the existing dataset builder reads. One export for everything, and a doctor's corrections become training data. One large task and an ADR. (Recommended.)
- B. Only annotate tasks make training data. Review tasks only measure the model. Nothing to build but buttons, and review corrections are not used for training.
- C. Merge the two kinds into one task with a switch for independent work. The simplest model to explain, and the largest rewrite, touching decisions, the queue, sign off and every export.

Your choice:

### B. When two reviewers draw different outlines for one object, who settles it?

- A. The adjudicator picks one of the outlines or draws a new one. Outlines count as different below a set overlap, changeable per task. The starting value is TODO and is picked in the task from fixture outlines. (Recommended.)
- B. A rule merges them with no person, for example the area most reviewers marked. No extra work, but a shape nobody drew enters the data.
- C. Shapes are not compared and the latest edit wins.

Your choice:

### C. Which training formats come next after QuPath GeoJSON and patches with masks?

- A. COCO JSON beside the patch tiles. (Recommended, it is the format you named and the most widely read.)
- B. COCO and also instance maps per tile for nucleus models in the HoVer-Net style.
- C. Nothing more for now.

Your choice:

### D. What is a dataset version?

- A. A frozen copy of the manifest and the GeoJSON, stored write once with a number and a checksum. Patches are cut again from it when asked. Small files, exact repeat. Storage cost per version: TODO, to be measured in the task. (Recommended.)
- B. A frozen copy of everything, tiles included. Exact and fast to download again, and the largest storage use.
- C. Only a saved recipe (task, filters, time) that is built again on demand. No storage, but a later change after sign off can make the same recipe give different data.

Your choice:

### E. Which objects go into a dataset by default?

- A. Only objects a person checked: agreed or confirmed, edited and added. Objects answered unsure or left open are left out and counted. (Recommended.)
- B. The same, plus unchecked AI objects marked `ai-unchecked`, as the annotate export can already do by a task option.
- C. Everything, with the origin left to the researcher to filter.

Your choice:

## What was not checked

- The deployed app. No sign in and no click were made.
- Whether each ticked task behaves on the deployed app as its tests say.
- No timing, size or cost was measured, so this file holds no measured number.
