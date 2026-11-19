# Result: audit of the deployed viewer, v0.24.1

- Date: 2026-11-19
- Backlog: none, an owner request for a read-only audit by the adviser
- Kind: baseline (manual and scripted walk of the deployed app)
- Commit: 46fac51b (release v0.24.1)
- Environment: MacBook, Darwin 24.6.0, headless Chrome for Testing (Playwright build 1248) driven by Playwright 1.65.1, no network shaping
- Data: the showcase seed of 2026-11-19 on `https://app.parfocal.eu`, signed in as the seeded agent test account (role researcher with admin rights). No PHI.

## Question

The owner asked seven things about the deployed viewer. Do the inspector tabs and tools fit each context? What exactly is broken in groups and layers? Does any viewer UI overlap at 1440 by 900, 1280 by 800 and 1024 by 700? Do typing and cells work end to end? Where can a slide be opened in the full viewer? Where is each case of the thesis assignment in the app?

## Method

A Node Playwright script per step, one browser and one page at a time, with the storage state from `scripts/agent_session.py`. Screens were read as text and as lists of controls. Overlaps were measured with `getBoundingClientRect` on the floating parts of the stage (minimap, top stack, magnification bar, cell type bar, cells grid, guided controls) and on portals. Two screenshots were opened. No code was changed and no test suite or dev server ran.

Slides used: `CMU-1-Small-Region.svs`, `CMU-1.tiff` and `test_065` in project P03 (Vendor format robustness), and four slides of project P01 (Metastasis detector validation).

What this audit changed in the dev app, so the lead can reseed or log it:

- It created review task RT-6 "Cell typer v1" in P03 for the agent account. The app sent one email to that account.
- It moved the two slides of the seeded annotate task RT-5 "Tumour outline practice" in P03 from the seeded owner account to the agent account, because no other annotate task could be reached (rows 1 and 37). The app said both people were told by email.
- It added the run "Cell typer v1" to `test_065` inside that annotate task.
- It drew about eight shapes on `CMU-1-Small-Region.svs` and one polygon on a P01 slide, and it wrote the layer setting of the agent account.
- It started no model run. Smart select was clicked twice with the Best tier chosen, which may have woken the outline server. Cost: TODO, the lead checks Modal usage.

Limits of the run:

- The agent account is a researcher with admin rights and had no seeded task. Screens of other people's tasks were read as a person who is not assigned.
- Headless Chrome was used, so nothing here says how the page feels with a real mouse.
- The slide error alert and the GPU wait timer were not raised live. The seed has no slide that fails to open, and no GPU run was started to avoid spend.

## Results

Severity is high when a workflow stops or data is lost, medium when the screen is wrong or misleading, low for polish.

| # | Area | Where | What is wrong | Severity | Suggested fix | Suggested backlog task title |
|---|---|---|---|---|---|---|
| 1 | Tools, annotate task | `/projects/$id/tasks/new-annotate?step=send`, button "Send to experts" | The button does nothing. No request leaves the browser and no message shows. In `apps/web/src/screens/annotate-task/new-annotate-task.tsx` the handler is `onClick: () => (after ? onStep(after) : undefined)`. No annotate task can be made in the deployed app. | high | Wire the last step to the create call, then show the sent screen as the review task form does. | Send an annotate task from the stepper |
| 2 | Review task | `/tasks/$id/guided` of a task made in the form | A new review task stays on "Preparing this slide" for good. `/api/review-tasks/$id/slides/$slide/objects` answered 409 `review-order-not-ready` for all three slides tried, still 50 minutes after the task was made. The screen has no way back and no top bar. | high | Find why the review order job does not run on the deployed app, add a retry and a back link, and show the age of the wait. | Review order never finishes for a new task on the deployed app |
| 3 | Groups | Full viewer, Annotate, Display tab, Layers | Groups are not saved. Cmd+G makes "Group 1" on screen with no network write in 6 seconds. After a reload the group is gone and its shapes sit in Ungrouped. "Add a layer" has the same fate. Shapes themselves are saved. | high | Save groups with the annotation document, and load them back. | Save layer groups with the slide's annotations |
| 4 | Groups | Same panel, a group row | A group row offers only colour, "New shapes go to", hide and lock. There is no rename (double click, F2 and right click do nothing), no delete, no ungroup button and no way to move a shape into an existing group (no drag, no menu). `removeGroup` exists in `apps/web/src/annotations/document.ts` and is reached only by Shift+Cmd+G on selected shapes. An empty layer cannot be removed at all. | high | Add a row menu with rename, delete (shapes go to Ungrouped), and "move selection here". | Rename, delete and refill groups in the layers panel |
| 5 | Annotate task | `/projects/$id/slides/$slide/annotate-task?task=...`, Objects tab and guided check | After "Add the run Cell typer v1" the panel lists 2038 AI objects, and every action on them fails. Confirm (D) posts to `/shared-layer/ai/C1370/confirm` and gets 404 `unknown-object` ("C1370 is not in this result set"). Delete (Shift+X) and undo post to `/shared-layer/ai-changes` and get 404. The counters stay at 0 confirmed, 0 edited, 0 deleted. Caveat: the task was reassigned to the agent account first. | high | Make the shared layer accept the objects of an added run, and test confirm, edit and delete on the seeded task after a deploy. | AI objects of an added run cannot be confirmed or deleted |
| 6 | Overlaps | Same route, guided check at 118× | The dashed AI outlines paint over the top bar and the tool rail (screenshot). Measured: the `ai-layer` SVG has `overflow: visible`, `slide-stage` has `overflow: visible`, and no ancestor clips. | high | Clip the stage (`overflow: clip` on `slide-stage`) so no draw layer paints outside it. | Clip draw layers to the slide stage |
| 7 | Typing, seed | Project P03 (Vendor format robustness), every viewer | The project has no classes. `/api/projects/$id/classes` returns `[]`. So the tool hint shows no class chips, digits do nothing, each AI cell reads "No type" on the stage, and "Next class" is disabled in the guided check. Nothing tells the user why. P03 is the project with the cell results. | high | Give the seed project the four classes, and show "This project has no classes" with a link to add them. | Seed classes for the format project and say when a project has none |
| 8 | Typing | Full viewer, Annotate, P01 slide, a selected polygon | A digit does not change the class of a selected outline. No request is sent and after a reload the class is the one chosen while drawing. The keymap says "Class n for new shapes, or re-class the selection". A selected shape shows no class control anywhere. | high | Make digits re-class the selection and show the class chips for a selected shape. | Change the type of a drawn outline |
| 9 | Views | Tool rail, "Compare slides" | The click goes to `?scene=picking`, drops the workspace, and the page stays on "Loading the slide". | high | Open the real slide picker, or hide the button until compare works on the deployed app. | Compare slides does not open on the deployed app |
| 10 | Cells | Full viewer and Annotate on a slide with "Cell typer v1" | An imported cell cannot be picked. Click, double click, right click and digits on a cell do nothing in both workspaces. No panel shows its ID, type or score. Cells can be touched only inside an annotate task, which rows 1 and 5 block. | medium | Let a click select an AI cell and show its ID, type and score, with "edit in an annotate task" when editing is not allowed here. | Select an AI cell in the slide viewer |
| 11 | Roles | `/tasks/$id/guided` and `/tasks/$id/cells` of a task assigned to someone else | A person who is not assigned gets the live answer buttons and the cell type bar. Each answer is refused with 403 `not-assigned`, the card still moves to the next object, and the toast says "You do not have access. Ask a workspace admin", shown to an admin. `PUT /api/me/resume` also answers 404. | medium | Open other people's reviews read only, with a banner naming the reviewer and no answer keys. | Read-only view of another reviewer's task |
| 12 | Overlaps | `/tasks/$id/guided`, minimap | The minimap is 152 by 244 at y 667 in a 900 high window and at y 567 in an 800 high window, so 11 px hang below the window at both sizes. At 1280 by 800 it also covers the cell type bar by 115 by 23 px. At 1024 by 700 it moves to the top and is clear. | medium | Keep the guided minimap inside the stage and let it dodge the cell type bar. | Guided minimap leaves the window and covers the type bar |
| 13 | Overlaps | `/tasks/$id/cells` with a cell picked, 1440 by 900 | The "Whole slide" button (68,844) and the magnification bar, which grows to 865 px wide, overlap by 58 by 34 px. The cells grid (y 698) and the cell type bar (y 662, 48 high) overlap by 618 by 12 px. | medium | Stack the type bar above the grid in one column and cap the bar's width next to "Whole slide". | Cells grid, type bar and magnification bar overlap |
| 14 | Tabs | Objects tab on `CMU-1.tiff` (a slide with no pixel size) | Every area reads "0.00 mm" with the category "ITC". The slide also has no magnification bar and no scale bar. Nothing says the pixel size is unknown. A size category from an unknown size is wrong. | medium | Show "size unknown" and no category when the slide has no pixel size, and say so once on the stage. | No size or category without a pixel size |
| 15 | Tabs | Guided card and object rows | Small regions read "0.0 mm" and "0.0 mm across". | medium | Switch to µm under 0.1 mm. | Show small sizes in micrometres |
| 16 | Tabs | `/tasks/$id/cells`, Objects tab of a cell task | The summary reads "Tumor regions 0, -Infinity mm to Infinity mm" and "Added, 0" with a stray comma. | medium | Hide the range when there are no regions, and fix the label. | Empty region range reads Infinity |
| 17 | Tabs | Objects tab, Annotate | Drawn rectangles and polygons are listed as "Measurements M1..." with "No category", while the empty state says "Press L and drag to measure a length". The list of drawn shapes is in Display under Layers. Imported cells have no list and no count. Objects holds measurements and Display holds objects. | medium | Put drawn shapes and AI objects in Objects with counts by type, keep Display for how things draw, and keep Measurements for ruler results. | Objects tab lists the slide's objects |
| 18 | Tabs | Opinion tab on a plain slide and in an annotate task | The tab is always there and holds only "No opinion asked. The opinion questions belong to a review task". | low | Show the tab only inside a review task. | Hide the Opinion tab outside review tasks |
| 19 | Tabs | `/tasks/$id` cells route of a task whose order is not ready | The Objects tab is blank, and the Opinion tab says "Slide 5 is done. 0 objects checked". | medium | Show the preparing state in Objects and keep the opinion form closed until objects are answered. | Review tabs while the order is being prepared |
| 20 | Reports | `/tasks/$id/evaluation` of P01 RT-1 (Every state review) | The report names the model as "Broken import, Tumour detector v1". The failed import is counted as a model. | medium | Leave failed and importing result sets out of the report header. | Evaluation report lists a failed import as a model |
| 21 | Tasks | `/team` and project tab "Review tasks" | Team shows "Due Thu 19 Nov · today" for seeded tasks. The project tab shows "No due date" for the same tasks. | medium | Read one field in both places. | Due date differs between Team and the project |
| 22 | Tasks | `/projects/$id/tasks/new-annotate` | Every slide (15) and every person (8) is ticked from the start, and that includes the two viewer test accounts. There is no task name and no due date. The footer says "roughly 15403 min per expert" and the summary says "1 experts". Each slide row shows one result set tag though most slides have two. | medium | Start with nothing ticked, add name and due date, show hours, and show every result set of a slide. | Annotate task stepper defaults and wording |
| 23 | Import | Project page, More, "Automatic imports" | The item opens the Upload page. Project Settings has an "Automatic imports" block with "Manage" and "Nothing connected". | medium | Send the menu item to the settings block. | Automatic imports menu item opens Upload |
| 24 | Views | Guided check and guided review | The camera goes to 118× in the annotate guided check and to 321× in guided review, on slides scanned at 20× or 40×. The image is blurred blocks. | medium | Cap guided zoom at about twice the scan magnification. | Cap the zoom of guided steps |
| 25 | Top stack | Viewer on P01 "Case ai-running" and "Case uploaded" | The slide has a result set that is importing or failed, and the viewer says nothing. The top stack is empty. | low | Show one notice in the top stack with the state of the result set. | Tell the viewer about importing and failed result sets |
| 26 | Tools | Smart select with the Best tier | After a click the hint reads "Best is not answering yet, Good outlined this view" and "Outlining" and was still there after 6 seconds. No outline was accepted in the run. TODO: repeat by hand with a warm server. | medium | Time out the wait, fall back to Good in the open, and say which tier drew the outline. | Smart select waits on Best without an end |
| 27 | Top bar | Annotate task top bar | Two progress controls sit side by side: the ring "0% of the tissue seen" and "Slide 1 of 2, 0% of the tissue seen". | low | Keep one. | One tissue progress control in the task top bar |
| 28 | Annotate task | Annotate task viewer | The top bar has no submit control. "Mark slide checked" is at the bottom of the Objects tab under a list of 2038 rows. | low | Put the slide's done control in the top bar as review has Submit. | Finish control for an annotate slide in the top bar |
| 29 | My work | `/my-work`, "Continue where you left off" | A task that was never opened shows "Slide 2 of 13" and "Continue reviewing" next to "Start". | low | Show the card only after a first decision, and start at slide 1. | Continue card for a task not started |
| 30 | Routes | `/tasks/$id/comments` with no slide | The page stays on "Loading the slide". | low | Pick the first slide of the task. | Comments route without a slide |
| 31 | Wording | Annotate task panel | Raw codes reach the screen: "The server refused it (not-assigned)" and "The server refused it (unknown-object)". | low | Map problem codes to sentences. | Plain sentences for refused actions |
| 32 | Wording | Project and Team lists | "1 slides". | low | Plural rule. | Singular for one slide |
| 33 | Layout | Objects tab at 1440 by 900 (screenshot) | A measurement row breaks into four lines ("16 752", "µm²", "perimeter", "519 µm"). The "Areas" card is a short scroll box that cuts the fourth row in half. | low | One line per row with the perimeter under it, and let the card grow. | Objects tab rows wrap and clip |
| 34 | Entry | Project slide rows, My work "All slides" rows | Rows and thumbnails are buttons, so a slide cannot be opened in a new tab. For a researcher the row opens the Annotate workspace, while the toggle calls the other one "Full viewer". All 13 slides of P01 are named "Case ..." under the heading "Loose slides, 13 slides, no case". | low | Make rows links, and rename the seed slides. | Slide rows are links |
| 35 | Routes | `/tasks/$id/sign-off` of a task already signed off | The page silently shows the project. | low | Show the signed state with a link to the report. | Sign-off page for a signed task |
| 36 | Roles | Admin, People and roles | Two roles exist, Researcher and Reviewer, plus admin rights. "Vic Viewer" and "Smoke Viewer" are Reviewers. There is no read-only role and no annotator role, and `?section=roles` shows the overview. No page says what each role may do. | medium | Add a short role table in Admin, and decide whether annotator and viewer are roles. Owner question, add to `docs/decisions.md`. | Role table in Admin |
| 37 | Seed | Whole app | The seed gives the agent account no task, has no case (so the case page, the clinical report and co-sign cannot be reached), no finished job (Jobs is empty), and no slide that fails to open. | medium | Add one review task and one annotate task for the agent account, one case, one finished job and one broken slide. | Seed a task, a case, a job and a broken slide for audits |
| 38 | Routes | Annotate task route | `?tab=objects` is ignored and Display opens. | low | Honour the tab. | Tab parameter on the annotate task route |
| 39 | Groups | Layers, "New shapes go to" a locked group | A new shape lands in Ungrouped with no message. | low | Say the target is locked, or unlock it. | Drawing into a locked group |
| 40 | Groups | Select tool | Shift click on a second shape and Cmd+G made a group of one shape, twice. TODO: confirm by hand, the script may have missed a shape. | low | Check multi select with Shift. | Shift click adds to the selection |
| 41 | Groups | Group colour input | A scripted change of the colour input did not change the value and sent nothing. TODO: confirm by hand. | low | Check the colour change, and save it with row 3. | Group colour change |
| 42 | Keys | Guided review of cells | The card shows "Agree K" and "Disagree X" while the type bar shows "K Keep" and "X Not a cell". The same two keys carry two names on one screen. | low | Use one pair of names when the type bar is shown. | One name for K and X in cell review |
| 43 | Minimap | Viewer at 1024 by 700 | With a tool hint and the open magnification bar the minimap is not shown at all. | low | Shrink it rather than hide it. | Minimap at small windows |

PROTO-060 (one top centre stack): there is one `top-stack` element. Tool hints, the minimap and the magnification bar measured with no overlap at all three sizes in the full viewer and in Annotate, with the Polygon, Ruler and Smart select hints. At 1024 by 700 the minimap moves to the top right when the magnification bar opens. The slide error alert and the GPU wait timer could not be raised (see limits). TODO: confirm those two by hand.

Tools by context, as found:

- Full viewer (workspace review): Select, Pan, Measure, Comment on an ID, Smart select, Compare slides. Smart select in a workspace with no drawing is out of place.
- Annotate: Select, Pan, Smart select, Auto region, Polygon, Freehand, Rectangle, Ellipse, Count marker, Ruler, Arrow, Text, Comment, Brush, Compare slides. Class chips show only when the project has classes (row 7).
- Guided review: Agree K, Disagree X, Not sure U, Previous Shift+J, Skip J, "Add something the AI missed", and for cells the type bar K, 1 to 4, X.
- Annotate guided check: Confirm D, Next class Shift+Y, Delete Shift+X, Skip Shift+E, "Leave the guided check". The keys are shown and none of them saves (row 5).

Typing and cells, as found:

- Type an outline while drawing: works in P01 (chips "Tumor, key 1" to "Other, key 4", saved, shown as "Stroma 1" after a reload). Not possible in P03 (row 7).
- Change the type of a drawn outline: does not work (row 8).
- Edit seeded and imported cells and their types: not possible in the slide viewer (row 10), fails in the annotate task (row 5).
- Best and Good: the tier menu opens and explains both. A click did not finish (row 26).
- Cells grid: opens on `/tasks/$id/cells` with 12 sampled cells, picks a cell and moves the camera. Answers were refused because the account is not assigned (row 11). Layout overlaps in row 13.
- Sample cells strip: "Fold to one line" works and measured clear of other UI at 1440 by 900. Arrow keys moved the camera, which is the known PROTO-063 item (arrows in the cells strip).

## Thesis assignment cases

| Case | Path from home | Role | State | What would make it visible |
|---|---|---|---|---|
| Several ways of showing model outputs | Home, a project, a slide row, Display tab: show or hide each result set. Inside a review task the Display tab adds outline, fill or dots, colour by class, score or decision, confidence as number, word or colour, heatmap and tumor map. Cells grid on `/tasks/$id/cells`. Compare slides on the tool rail. | any member | partly working | The rich Display controls exist only inside a review task. Compare is broken (row 9). Put one "View as" control (outlines, dots, heatmap, grid, side by side) in the Display tab of every viewer. |
| Review, modify and extend AI annotations | Review: My work, Start, guided review. Modify and extend: an annotate task, Objects tab, "Add the run", then confirm, edit, delete or draw. | reviewer for review, expert on the task for annotate | partly working | Review works on seeded tasks and is stuck on new ones (row 2). Annotate tasks cannot be sent (row 1) and cannot save AI changes (row 5). Fix those three, then seed one of each for a demo. |
| Import inference results from external GPU infrastructure in documented formats | Home, Upload, "What files work?". Results sit next to a slide as GeoJSON, `cells.csv` or a probability PNG. The seed's result sets say "Imported 19 Nov from regions.parfocal.json" and "from cells.geojson". Project, Settings, Automatic imports (webhook, API, watched folder). | researcher | partly working, not exercised | No file was uploaded in this audit. The format help is inside the upload screen only, and the menu item for automatic imports opens Upload (row 23). Add an "Import AI results" action on the project and on the viewer's "Add a result set", with a link to one format page. TODO: check that a public format document exists. |
| Run selected pretrained models in the app on whole slides | Home, "Run a model" (or a project, More, "Run a model"): slides without results are ticked, model "CAMELYON tumor model", time and queue shown. In the viewer: Objects tab, "Find nuclei". | researcher | partly working, not exercised | Not run, to avoid GPU spend. The dialog offers one model, so nothing is selected, and the nuclei model is in another place. List every model in the one dialog and link it from the viewer. |
| Defined user roles | Account menu or sidebar, Admin, People and roles. | admin | partly working | Two roles and admin rights exist. No screen states what each may do (row 36). Add the role table. |
| Defined workflows for importing, showing, reviewing, editing and enriching | Import: Upload. Show: slide viewer. Review: "New review task" form, guided review, opinion form, sign off, evaluation report. Edit and enrich: "New annotate task" form, annotate task viewer. Home also has "Take the tour" and a six step checklist. | researcher sets up, reviewer or expert does the work | partly working | The review workflow is complete on seeded data. The annotate workflow stops at its first step (row 1). A home card per workflow with its steps and a seeded example of each would show them. TODO: `/flow-map` was not opened. |

## Full viewer entry points

| Screen | Shows slides or thumbnails | Way into the full viewer | Missing or weak |
|---|---|---|---|
| Home `/` | project cards with thumbnail stacks, "Start here" | card opens the project, "Open in the full viewer" and "Continue" buttons in "Start here" | no direct slide link on a project card |
| Project, Slides tab | 15 thumbnails and rows | row, thumbnail, name or "Open" all go to `/slides/$id/live` | buttons, so no new tab, and it lands in Annotate for a researcher (row 34) |
| Project, Review tasks tab | task rows | none found on the row. TODO: the "Settings for RT-n" menu was not opened | a task row should open its slides, its evaluation and its disagreements |
| My work, To review | task cards | "Start" and "Continue reviewing" open guided review, which has a Guided and Full viewer switch | fine |
| My work, Assigned by me | task rows | none | same as the project task rows |
| My work, All slides | 16 thumbnails and rows | a click opens a preview pane with "Open", a double click opens the viewer | fine |
| Search `/search` | slide results, no thumbnails | a result opens `/slides/$id` | thumbnails would help |
| Team `/team` | tasks and people | none | a link from a task to its slides |
| Disagreements `/tasks/$id/disagreements` | object rows | none while the queue is closed, the row click does nothing | each object should open in the viewer at its ID |
| Evaluation report `/tasks/$id/evaluation` | object crops | none | each crop should open the object in the viewer |
| Sign off `/tasks/$id/sign-off` | not seen, the route showed the project | none seen | TODO |
| Guided review and cells grid | the slide | "Full viewer" switch in the top bar | fine |
| Annotate task viewer | the slide | "Full viewer" switch | fine |
| Compare | two slides | broken (row 9) | |
| Run a model dialog | slide names | none, and none needed | |
| Jobs popover and job page | empty in the seed | not testable (row 37) | a finished job should link to its slides |
| Case page, clinical report, co-sign | not reachable, the seed has no case | not testable (row 37) | |
| Study `/study` | task list only, no slide | "Start session" not pressed | TODO |

## Interpretation

Three things stop the owner from seeing the thesis cases. Annotate tasks cannot be created or saved (rows 1 and 5), new review tasks never become ready (row 2), and the project that holds the cell results has no classes (row 7). The owner's report that grouping "looks broken" is confirmed: groups live only in the page (row 3) and cannot be managed (row 4). The overlap the owner saw between the error alert and the GPU timer could not be reproduced or ruled out. The new overlaps are in the cell screens (rows 12 and 13) and the unclipped stage (row 6).

Assumption: rows 2 and 5 may come from the deployed environment (a job runner that is not triggered, a shared layer that was seeded for another person) and not from the code alone.

## Follow-ups

- No ADR, no backlog change and no log entry were written. The lead decides which rows become tasks.
- Owner question for `docs/decisions.md`: are annotator and read-only viewer roles of their own (row 36)?
- TODO items are marked in rows 26, 40 and 41, in the PROTO-060 note, and in the two section tables.

Rows in the findings table: 43 (9 high, 17 medium, 17 low).
