# 0012. Prototype round 2: staging-first findings, quiet top bar, upload window and clearer compare

- Date: 2026-10-07
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: edits SHELL-003, CASE-002, CASE-004, CASE-011, NAV-004, NAV-008, NAV-010, REVIEW-002, REVIEW-003, REVIEW-004, REVIEW-008, DS-012, MEAS-000, CMP-004, REPORT-003, REPORT-006, AITUM-003, INGEST-002, EXP-008, SET-004 and the mock numbering in "How to use". Adds CASE-013, REVIEW-016, REVIEW-017, MEAS-006, CMP-007, AINUC-012, INGEST-021, INGEST-022 and EXP-009.

## Context

The backlog was written from the UX kit and the hi-fi mock as they stood on 2026-10-06. Since then the prototype pair changed in four ways, partly from a design review and partly from the first unmoderated pilot on viewer-ux-study.vercel.app.

1. The case top bar showed patient data, specimen, a slide stepper and five buttons at once, and a 96 px slide tray took width on every screen.
2. Slides had no upload flow.
3. The findings panel led with "about 47% of the cells here are tumor, above the 20% cutoff". That is how a block is checked for enough tumor before molecular testing. A sentinel lymph node is staged by the size of its largest metastatic deposit: over 2 mm is a macrometastasis, over 0.2 mm or more than 200 cells a micrometastasis, and up to 0.2 mm with up to 200 cells isolated tumor cells. POC [doc 36](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/36-sentinel-node-areas.md) records the reasoning and an evaluation of areas taken from the existing tumor map.
4. Pilot participants could not tell how the compare pair was chosen, and tried to click the minimap to open the whole slide, which did nothing.

The kit records these as decisions D15 to D23 and the mock shows each one.

## Options considered

1. Keep the backlog as written and treat the new prototype as a later iteration. Cheap now, but the review and report tasks would build a verdict that does not answer the sentinel node question, and the compare and minimap tasks would ship controls the pilot showed people cannot find.
2. Edit the affected tasks and add the missing ones, keeping every existing ID. The backlog stays the single source and nothing already planned is lost.
3. Replace the REVIEW epic. Cleaner on paper, but most of it (gallery, focus review, wording, outline modes, track record) still holds.

## Decision

Option 2. The edited and added tasks follow the prototype pair as published on 2026-10-07.

- The case top bar keeps back, a case chip, a slide button, Review and Annotate, the viewed ring, the panel toggle, a "more" menu and Sign out. Details open in popovers. The slide tray becomes an optional pinned strip.
- Upload is a window that opens from several places and from a drop, shows the label image and case match per file before upload, offers one-click fixes for the four problem classes seen in practice, and keeps running in a corner tray.
- For a sentinel node, findings lead with the largest deposit on a size scale with the 0.2 and 2 mm lines. Each area asks three steps in order: is it tumor, how big is it, and only near 0.2 mm, how many tumor cells. Once the largest area is confirmed and measured, the category is settled and the smaller areas are marked as unable to change it. The tumor share verdict from doc 33 stays for specimen types that ask for cellularity (REVIEW-017).
- Areas come from the existing tumor map. The outline is drawn at 0.5, an area is listed only if its peak reaches 0.97, and its size is the widest distance across its hull. On tumor_009 this listed 7 areas for 6 deposits and sized the largest at 8.1 mm against 8.1 mm. That slide is in the model's training set, so AITUM-003 must repeat the evaluation on CAMELYON16 test slides before the size range shown to doctors is fixed.
- Compare labels each pane and makes the label the picker, with Side by side in the slides popover and Swap sides in the panel.
- The minimap opens the whole-slide peek on click, and a tap on Z keeps the peek open. The earlier "tap toggles the last two magnifications" is dropped, because a tap now latches the peek open, which the pilot tested, and both cannot share the key. Double-click can still be set to toggle the last two magnifications.
- Study mode records replays. The recorder is served first-party because ad blockers blocked it in the pilot, and uploads are batched because per-five-second uploads used about 270 storage writes per session against a free plan of 2,000 a month.

## Consequences

- The mock gained an Upload slides screen at step 3, so every mock step from Case at low power onwards moved up by one. All `mock N` references in the backlog were renumbered in the same change.
- REVIEW-003 and REVIEW-004 now build staging, not a tumor share verdict. REVIEW-017 keeps the share verdict for cellularity cases, so doc 33's work is not lost.
- AINUC-012 is new work: a tumor cell count per area with a range, which needs nuclei or the 64 px map because a 0.2 mm cluster is three cells across on the 256 px map.
- The staging wording and the suggested pN stage must be checked with a pathologist in MEAS-000 before any of this is shown to a doctor.
- The usability plan now has ten pilot tasks, and EXP-008 and EXP-009 follow it.
- [ADR 0013](0013-cell-findings-shortcuts-and-ai-on-upload.md) keeps this staging layout for sentinel nodes and makes cell findings the default for other specimens, and moves the pilot to round 4.
