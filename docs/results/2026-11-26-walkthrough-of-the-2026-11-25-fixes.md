# Result: walkthrough of the 2026-11-25 fixes on app.parfocal.eu v0.59.0

- Date: 2026-11-26
- Backlog: the 24 PROTO tasks, ADMIN-013 (People row menu) and ADMIN-015 (templates row menu) from the owner's 2026-11-25 walkthrough, each named in the table
- Kind: deployed check
- Commit: fbafad31 (release v0.59.0 deployed)
- Environment: Mac, headless Google Chrome through Playwright 1.65.1, 1440 x 900 unless named, signed in as the agent test account by `scripts/agent_session.py` in the `cvut-biomedical` workspace
- Data: seeded dev slides only (CMU-1-Small-Region.svs in "Showcase case review", test_065 in "Cell typing tour", CMU-1.tiff, the DICOM copy of CMU-1-JP2K-33005, Philips-3.tiff in "Walk preparing check"). No PHI

## Question

Does the deployed clause of each task from the owner's 2026-11-25 walkthrough hold on the deployed app?

## Method

Throwaway Playwright specs in the agent scratchpad ran against `https://app.parfocal.eu` with the saved storage state, one worker and one headless page at a time. They log what they measure (current object, data attributes, PUT counts, bounding boxes, computed colours) instead of asserting the fake API's fixtures, and each task is judged from those numbers. No screenshots were opened.

## Results

Counts: 14 PASS, 2 FAIL, 10 NOT CHECKED.

| Task | State | Evidence |
|---|---|---|
| PROTO-173 (J and Shift+J step through review objects) | PASS | On the six objects of "Showcase case review" J and Shift+J moved one object each way after a Disagree, after the "T5 saved as Tumor" toast, with the outline editor open (the editor closed on J) and with the brush open. Shift+J at object 1 stayed on T3 with Previous disabled |
| PROTO-176 (guided final form) | PASS | The form opened after the 5th K with no "is still open" line, 6 dots and none unanswered. Back to T6 left it, U came back with the rating kept, Shift+J left it on T6, J returned to it, a dot jumped to T3 |
| PROTO-192 (hide the cell type bar) | PASS | Shift+B hid the bar and showed the one line hint of the keys, K sent a PUT to /decisions/ while hidden, a reload kept it hidden and "Show the type bar" brought it back. The shown bar kept clear of the cell plus a 24 px margin near all four edges |
| PROTO-193 (What is wrong chips) | FAIL | In guided cell review of "Cell typing tour" both the Disagree button of the type bar and the X key recorded a disagree and moved on to the next cell (C96 to C919 to C398). No "What is wrong" chips were shown, so their saved state could not be checked |
| PROTO-174 (Move points draft, one PUT) | PASS | On T3 (4 points) two drags sent no PUT to /edits/, Done sent exactly one PUT (200) and showed "New outline saved for T3". The drag did not make the outline cross, so the red crossing edges were not seen |
| PROTO-175 (Add a region the AI missed) | PASS | The button armed the polygon tool, four clicks and a close sent one POST /added (201), the layer listed T1+, the code was listed after a reload, and no toast or text said prototype |
| PROTO-194 (object opacity) | PASS | At 10% the main outline drew at 0.1, the fill at 0.076 in Fill mode, the dots at 0.1 in Dots mode and the current ring at 0.55, and data-opacity stayed 10 after a reload. A rectangle drawn in the plain viewer outside a task drew at opacity 1 (finding 3) |
| PROTO-184 (layers tree) | NOT CHECKED | Three rectangles were drawn on CMU-1.tiff, but the click on a shape row timed out because the row was not visible and stable |
| PROTO-180 (Smart select and Auto region bars) | PASS | At 1280 px the Smart select bar was one row 40 px high with the hints line under it (top 101 px, bar bottom 96 px), and the Auto region bar one row 40 px high. The model dropdown listed Best (PathoSAM ViT-L, server GPU) and Good (PathoSAM ViT-B, on this computer) |
| PROTO-181 (queued clicks) | PASS | On Best, three Shift clicks during "thinking" showed three queued markers, data-queued 3 and "Outlining, 3 queued". Backspace left 2 markers and "2 queued", and the outline came back in 24.3 s with 3 points in 2 requests. The numbers inside the markers were not read |
| PROTO-185 (Auto region outline marches) | NOT CHECKED | The probe loop ran out of test time before the proposals appeared, so no state was logged |
| PROTO-182 (typed and colored Smart select cells) | FAIL | With typing on, Best found 3 proposals that were accepted with Enter, but no POST /outline-types was sent within 180 s and no "Typing" status showed. With typing off a Good cell was grey (#a3a3a3) with no type or class and no typer call, and the off switch survived a reload |
| PROTO-170 (compact page header) | NOT CHECKED | `GET /api/projects/{id}/cases` answered 404, so the probe found no case and stopped before the report and new task pages were measured |
| PROTO-169 (skeletons do not jump) | PASS | With 400 ms latency and 150 kB/s the cumulative layout shift was 0 on report, co-sign, new task and upload, 0.0008 on Admin, 0.011 on Team and 0.0087 on My work. The report and co-sign pages had no case id, so they showed their not-found state |
| PROTO-171 (Showcase PDF matches its preview) | NOT CHECKED | No case id was found, as for PROTO-170 |
| PROTO-172 (template sample PDF) | NOT CHECKED | The Preview click on the templates page timed out |
| PROTO-179 (new project empty states) | PASS | A new project's Slides tab said "No slides in this project yet" with Choose files and Link a remote source. Link opened the upload with "From a link or storage" picked, a chosen file opened the upload wizard with its name, Review tasks offered New review task, and a no match filter said so and Clear filters brought back 15 rows |
| PROTO-177 (Decide panel fits) | PASS | On "Decide C66 on Philips-3.tiff" the chip and the five buttons from Certainly not to Certainly were inside the panel at 1440 and 1100 px. The slide name was short, so its truncation was not seen |
| PROTO-178 (Expand and magnification bar) | NOT CHECKED | Expand opened a view with the Decide panel but no dialog role, the Agree step was not reached, and the bar probe flagged parts past the bar's edge at both widths that may be hidden on purpose (finding 5) |
| PROTO-183 (rail tooltip contrast) | PASS | The Select tooltip name read 14.27 to 1 and its hint 10.50 to 1 in dark, 17.93 and 8.45 to 1 in light |
| PROTO-186 (sharp whole slide on Z) | PASS | On test_065, Z gave data-source "sharp" and data-picture-width 1216 against a 938 px map at device pixel ratio 1. Only ratio 1 was tried |
| PROTO-187 (Comments tab header at 280 px) | PASS | At a 280 px side panel the Open and Resolved switch sat inside the panel under the title, "Resolved N" was visible and one Pin showed. The slide name was CMU-1-Small-Region.svs, not a long one |
| PROTO-188 (no Enter posts hint) | NOT CHECKED | The probe timed out reading the reply box before the pin composer step |
| PROTO-190 (slide switcher fits) | PASS | On CMU-1-JP2K-33005-v2 (DICOM) at 1440 and 1024 px the popover stayed in the window (462 px wide) and no button or link was outside it |
| ADMIN-013 (People row menu) | PASS | Every member row had a More menu, "Make a researcher" changed role-viewer from Reviewer to Researcher, a reload kept it, and "Make a reviewer" put it back. No invite row with a menu was found, so invite rows were not checked |
| ADMIN-015 (templates row menu) | NOT CHECKED | The five built-in rows have a More menu, but the items were read before the menu opened and the models page was not reached |

The study dry runs for EXP-021 and EXP-020 (`scripts/study-prepare-dry-run.sh`, `scripts/study-join-dry-run.sh`) were not run for lack of turns.

## Findings

1. Guided cell review, "Cell typing tour" on test_065. Open a cell and press Disagree in the type bar or X. The disagree is recorded and the review moves to the next cell at once, so the "What is wrong" reasons never show (PROTO-193).
2. Annotate on CMU-1.tiff with the Best model and typing on. Find three cells with Smart select and accept them with Enter. No /outline-types request is sent and nothing says typing ran (PROTO-182).
3. The plain viewer of CMU-1.tiff, opened with no task, after the opacity was set to 10% in a review task's Display tab. A drawn rectangle still draws at opacity 1. This may be meant if the setting belongs to the task's display (PROTO-194).
4. `GET /api/projects/{id}/cases` answers 404 for the clinical project "Breast surgery sentinel nodes", so a script cannot list its cases this way. The app may read cases from another path.
5. The disagreement queue of "Walk preparing check" at 1440 and 1100 px. Parts of the magnification bar (1.25×, the digital reading and 100%) have boxes past the bar's edge. They may be hidden parts, which one screenshot would settle (PROTO-178).

## GPU time and cost

One GPU session ran, the Best Smart select clicks for PROTO-181 and PROTO-182, from 2026-11-26 02:55:19 UTC to about 02:59 UTC. The first Best outline came back 24.3 s after the click. No typer call was made, so there is no typer time, calibrated value or outline-types response status to record.

`modal billing report --for today` showed the GPU app at $0.23413704 before the walk (about 02:20 UTC) and $0.37871682 at 03:03 UTC, and the api app at $0.02077384 and $0.03649095. So the walk cost at most $0.1446 of GPU and $0.0157 of api time. Other agents ran on the same Mac in the same hour and may have used the GPU too, so these are upper bounds.

## Follow-ups

- The FAILs of PROTO-193 (disagree in guided cell review skips the reasons) and PROTO-182 (no typer call after a Best accept) go back to their tasks.
- The NOT CHECKED tasks need a second deployed pass: PROTO-184 (layers tree), PROTO-185 (marching Auto region outline), PROTO-170 (compact header), PROTO-171 (Showcase PDF), PROTO-172 (template sample PDF), PROTO-178 (queue Expand), PROTO-188 (no Enter posts hint) and ADMIN-015 (templates row menu), then the study dry runs of EXP-021 and EXP-020.
- The test account role-viewer was set back to Reviewer in "ČVUT · Biomedical Engineering". The walk left a new project "Walk empty states 1126", a missed region T1+ on "Showcase case review" with every object of its first slide decided, a few decided cells in "Cell typing tour", and three rectangles and four Smart select cells on CMU-1.tiff in "Scanner format comparison".

## Second pass on v0.61.1

- Date: 2026-11-26, from 04:35 to 05:50 CET
- Commit: cfe04b4a (release v0.61.1 deployed)
- Environment: as the first pass, a fresh session saved by `scripts/agent_session.py --out` for this pass, headless Chrome through Playwright 1.65.1, one page at a time, 1440 x 900 unless named
- Data: the same seeded dev slides, plus a sample project made through setup in "ČVUT · Biomedical Engineering". No PHI

### Method

Throwaway Playwright specs in the agent scratchpad waited on the app's own data attributes and visible elements with cold start timeouts of 60 to 90 s, and logged what they saw. Cases were found with `GET /api/cases`, the path the API client uses, which answered 200 with three Showcase cases. Two pictures were opened, the queue's magnification bar and page 1 of the templates sample PDF.

### Results

Counts: 10 PASS, 5 FAIL, 0 NOT CHECKED.

| Task | State | Evidence |
|---|---|---|
| PROTO-193 (What is wrong chips) | PASS | In guided review of "Cell typing tour", X on C398 and the type bar's Disagree on C1088 each stayed on the cell, hid the type bar and showed "You disagree with the AI on C…" with Not a cell ticked. Artefact ticked at once and sent a PUT with `["not_a_cell","artefact"]`. Next, Previous and X again showed both still ticked on both cells |
| PROTO-182 (typed and colored Smart select cells) | FAIL | The Enter fix holds: right after picking Best the focus was on the Best option, and after the slide click and before Enter it was on the page body. One Best click gave 1 proposal in 7.8 s, Enter added the cell (5 to 6) and sent POST /outline-types at once with the chip "Typing 1 cells". The typer answered 503 `typer-offline` in 4.4 s because the worker raised `SlideWithoutScaleError` (no microns per pixel on CMU-1.tiff). The cell stayed untyped and grey (#a3a3a3), hover showed no type tag, and the Typing chip stayed for more than 120 s (finding 6). No toast was checked |
| PROTO-189 (comments on AI objects) | PASS | On "Cell typing tour", C on C398 opened "Comment on C398", typing # listed C303, C96 and more, and the posted comment showed as an anchor, no pin. The Comments tab listed it under C398 as Cell, its card opened "Comments on this object C398" in the side panel, and the C303 link moved the object to C303. The comment tool click on C657 opened "Comment on C657", its thread was listed under C657 and opened in the side panel. A drag made a Region thread, listed as Region Area, and /tasks/ID/comments opened it in the thread reader |
| PROTO-191 (add result sets from the viewer) | PASS | On CMU-1.tiff a dropped GeoJSON previewed 2 objects ("shown in cyan and not saved yet", To slide CMU-1.tiff) and Cancel removed the panel and preview with no new row. A dropped CSV previewed 3 points with no fixes, Save asked to map the unknown class Walkcell, Import added the row "CSV import walk2_65386_cells.csv" (2 to 3 rows) and the "… added" toast, 33 s after Save. Which class was picked from the list was not logged |
| PROTO-184 (layers tree) | FAIL | At the default side panel width (340 px, a 281 px tree) every shape row whose measure is long, such as "11559643 px² · 14046 px", has a 0 px wide name button, so its object ID is not shown and the row cannot be clicked (finding 7, and the cause of the first pass timeout). Rows with a short measure keep a 17 px name. Where a name could be clicked, the row selected its shape, Cmd+G made a group, Shift click picked a range, a drag gave data-drop "into" and moved the rows into the group (1 to 5), collapse set data-expanded false and a reload kept both the rows and the collapse. A rename was kept after a reload. The 5000 cell scroll was not tried |
| PROTO-185 (Auto region outline marches) | PASS | With Good, the auto outline was `working` with animation `pf-march` for at least 16 s, the last state logged, then 30 proposals showed and the outline was gone. With reduced motion the working outline had animation none. The done tiles were not seen, because Good reported 0 of 0 tiles. See finding 8 for the run that ended "Not done" |
| PROTO-170 (compact page header) | PASS | At 1440 x 1011 the content started 72 px below the top of the Showcase case clinical report and 104 px on the new review task, both at most 108 |
| PROTO-171 (Showcase PDF matches its preview) | FAIL | "Download PDF" gave Showcase_case_report_v1.pdf whose text holds the preview's headings, synoptic labels and values (ICCR, CAP, TNM, pN0(sn), Not assessed) and no raw "na". The only missing labels are line wraps. But the preview says "Reported 23 Nov 2026, 22:17" and the PDF "Reported 23 Nov 2026, 21:17" (finding 9) |
| PROTO-172 (templates sample PDF) | PASS | Preview opened a dialog "Sentinel_node_AI_evaluation_sample.pdf, A4, portrait, 3 pages". The downloaded PDF embeds only IBM Plex Sans (Regular, SemiBold, Bold), is A4, and page 1 shows the Results, cell type and disagreement tables with ruled rows |
| PROTO-178 (Expand view and magnification bar) | FAIL | Expand from the queue row C66 of "Walk preparing check" grew the view from 484 x 360 to 1060 x 630 with the Decide panel, the bar fit there, and Certainly 5 returned to the queue. In the queue view the bar is 452 px wide with 286 px more content: the screenshot shows 1.25× cut off on the left, the scale line running into the right edge, and the digital reading and brightness 100% hidden past it (finding 10). The bigger view drew 0 reviewer outlines, there was only one row so no next row was seen, and 360 px was not tried |
| PROTO-188 (no Enter posts hint) | PASS | The new pin box on a review slide of "Breast surgery sentinel nodes" in annotate mode showed only "Send ↵", with no hint line. Shift+Enter added a line and Enter posted. The reply boxes seen in the PROTO-189 run showed "Reply … Send ↵" and "Reply ↵", with no hint line either |
| ADMIN-015 (templates and models menus) | PASS | Both opened template menus had "Use for new projects" and "Retire", each 28 px high on a 20 px line, one line each. The models page had no More buttons, but it has no lab model rows ("Your lab has no model connected"), so that half shows nothing |
| ONB-012 (sample in setup) | PASS | No workspace was made. The check ran in the existing workspace "ČVUT · Biomedical Engineering", so the create step and a "Created" line on Done were not checked, because `scripts/agent_session.py` refuses an account that sits in any workspace outside the seeded four and the app has no way to leave or delete a workspace, so a new workspace would lock every agent out of the deployed app. Setup offered "Open the sample project: 12 slides with AI results, a review of 4 of them with regions and typed cells, and one slide to run a model on", and Done said "Sample project ready: 12 slides, a review of 4" and "Run a model on CMU-1-Small-Region.svs". The project P05 held 12 slides and RT-1 "Try a review" with 4 slides, 3 of them submitted by the seed, and CMU-1.tiff was "Slide 4 of 4, Last slide" with 20 sampled cells. In guided mode C32 was current and Certainly 5 sent PUT /decisions/C32 (200), so 1 of 20 was decided. The run on CMU-1-Small-Region.svs ("About 2 min") started at 04:14:34 UTC and finished at 04:16:30 UTC by `/api/me/jobs`, 116 s, with 11 of 11 tiles. Only the queued card was read in the tray (finding 14). The result is a result set "PathoSAM + HoVer-NeXt v1.2" of 2428 cells (96 Tumor, 1659 Stroma, 300 Immune, 373 Other). Cost is under GPU time and cost below |
| EXP-021 (remove from the console) | PASS | The prepare dry run prepared P-JNTJ in 23 s and walked four tasks, then stopped at change-type (finding 11), so its own remove step was not reached. Its result file is docs/results/2026-11-26-study-prepare-dry-run.md. Removed by hand: Remove the project for P-JNTJ, pressed in /study/console with the account's active workspace on cvut-biomedical and no admin rights in cvut-study, answered "The project of P-JNTJ is removed." in 12 s, so no admin raise was needed |
| EXP-020 (one join link to the thank you page) | FAIL | The first run was refused, "Only a workspace admin can prepare or remove a participant." The account's active workspace was checked and set to cvut-biomedical (it already was), and the rerun made the link in 16 s, opened it in a fresh browser with no sign-in and walked four tasks, then stopped at the same change-type step. Its result file is docs/results/2026-11-26-study-join-dry-run.md |

### Findings

6. Annotate on CMU-1.tiff with Best and typing on. Find one cell with Smart select and accept it with Enter. POST /outline-types answers 503 "No typer worker is answering" while the Modal log shows the typer raising `SlideWithoutScaleError` because the slide has no microns per pixel, and the "Typing 1 cells" chip stays for more than 120 s after the 503 (PROTO-182).
7. Annotate on CMU-1.tiff, Layers tab at the default side panel width (340 px) and at the 280 px minimum. The measure column takes the whole row, so each shape row's name button is 0 px wide, the object ID is not shown and cannot be clicked. Rows with a short measure keep a 17 px name (PROTO-184).
8. Annotate on CMU-1.tiff, Auto region with Good under reduced motion. A 280 px drag stayed working and had ended "Not done" with no proposals by 300 s, while the same drag without reduced motion gave 30 proposals after at least 16 s. A second 200 px drag in both runs ended at once with the outline "failed", and in the reduced motion run the bar said "Too large" (PROTO-185).
9. Clinical report of the Showcase case. The screen says the report was reported at 22:17 and its PDF says 21:17, one hour apart, likely UTC against local time (PROTO-171).
10. Disagreement queue of "Walk preparing check" at 1440 px. The magnification bar under the 484 px slide view is 286 px too narrow for its content, so 1.25×, the end of the scale line, the digital reading and brightness are cut off (PROTO-178).
11. Study walk task "change-type" in both dry runs. Choosing Immune in the type bar on the first open cell does not finish the task, so the walk stops there (EXP-021 and EXP-020).
12. Setup with the workspace step skipped. Done lists a bare "Joined" line with no workspace name, although nothing was joined (ONB-012).
13. The sample review RT-1, CMU-1.tiff opened from its link in the Review tasks tab, which carries no mode. No cell is current, J does not step to one and "Show the cells" changes nothing in the panel. With `mode=guided` the first cell is current at once (ONB-012).
14. Jobs tray during the sample run. The probe read the tray every 10 s and saw "Running · 1 … Waiting for a GPU" unchanged for 18 min, while `/api/me/jobs` says the job finished 116 s after it started. The tray may not refresh a job it already shows, which one more check with the tray open would settle (ONB-012).

### GPU time and cost

Two GPU jobs ran. The PROTO-182 Best click and typer call ran from 03:37:53 to 03:38:06 UTC, and the ONB-012 run from 04:14:34 to 04:16:30 UTC. `uvx modal billing report --for today -r h --csv` showed `parfocal-gpu-pool` in `main` at $0.19709902 for the 03:00 UTC hour just before the first job and $0.31659214 after it, so the first job cost at most $0.1195. The 04:00 UTC hour had no GPU row before the run and $0.19595030 at 04:35 UTC, so the run cost at most $0.1960. Another agent made GPU calls (view-embedding, outline-types, view-map) in both hours, so both are upper bounds. The typer itself returned no calibrated time, because it failed.

### Left behind in the dev app

The sample project P05 "Sample · sentinel nodes" in "ČVUT · Biomedical Engineering" with C32 decided and a new cell result set on CMU-1-Small-Region.svs. On CMU-1.tiff in "Scanner format comparison": the result set "CSV import walk2_65386_cells.csv", one untyped Smart select cell, nine more rectangles, two groups named "Walk2 margins", one holding five shapes. In "Cell typing tour": decisions with reasons on C398 and C1088 and Walk2 comment threads on C398, C657 and a region. In "Walk preparing check": C66 decided Certainly 5. A two line pin in "Breast surgery sentinel nodes". The join dry run's project P-7QQZ was removed from the console too. Neither session had a row in the console results, so no Dry run tick was set. The account's active workspace is cvut-biomedical and the Annotate side panel is back at 340 px.
