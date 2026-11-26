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
