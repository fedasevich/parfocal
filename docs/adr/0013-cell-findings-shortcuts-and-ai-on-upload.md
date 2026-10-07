# 0013. Prototype round 3: cell findings from zones of unsure cells, a neutral unsure colour, a shortcut editor and AI steps on upload

- Date: 2026-10-07
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: edits REVIEW-002, REVIEW-005, REVIEW-006, REVIEW-007, REVIEW-009, REVIEW-012, REVIEW-017, DS-001, DS-002, DS-012, AILEARN-003, AIP-011, SET-007, CMD-003, CMD-006, INGEST-021 and EXP-008. Adds REVIEW-018, REVIEW-019, INGEST-023 and INGEST-024.

## Context

[ADR 0012](0012-ux-round-2-prototype-revisions.md) made the findings panel staging-first: it led with the largest tumor deposit of a sentinel node. Most cases will not be sentinel nodes. The whole-slide pipeline gives cells only: every nucleus with an outline, a type, the scores for all four types and two flags (a second typer disagrees, the outline may not be a nucleus). The POC already turns that into a 31 µm grid of the share of unsure nuclei (`uncertaintyField` in `src/segment/confidence.ts`) and already groups grid cells into areas (`src/segment/tumor-areas.ts`). Doctors also prefer to correct cell types themselves, and the per-slide learner from POC doc 22 learns from those corrections.

The design was settled in an interview with the owner and built into the hi-fi mock (version 26) and UX kit (version 11). Four more problems came up on the way:

1. The first cell findings draft invented zone descriptions ("large pale cells in a sinus") and a histiocyte class that the models cannot produce.
2. The amber used for unsure cells was 1.4 ΔE2000 from the "other" class colour under tritan simulation, and the green used for checked cells 3.8 from stroma. Both read as class colours. Measured with `scripts/color-check.mjs` in the POC, which re-measures every pair from POC doc 35.
3. Shortcuts could only be changed through a preset and six rows, and a separate read-only sheet showed the same keys a second time.
4. Upload had one "run the AI pre-read" switch, while models apply to some specimens and stains only, and a whole slide takes minutes to hours.

## Options considered

1. Keep findings staging-first and add cells as a fold. Little change, but most cases would open on a panel that does not answer their question.
2. A slide-wide queue of the least sure cells, with no zones. Simple, but each next cell can be anywhere on the slide, so the view jumps.
3. Zones of unsure cells, computed from the whole-slide cells, worked through zone by zone, with node staging kept for sentinel nodes. Chosen.

For the unsure colour, every remaining hue was measured against the four class colours under the three colour-vision simulations. All sit close to one class. A neutral with a pattern was the only choice that stays as far from the classes as the classes are from each other.

For shortcuts, a separate read-only sheet next to an editor was weighed against one page. The editor already searches and says what a key does, so the sheet was dropped.

## Decision

- Findings for cell cases show one number line (the tumor share and its likely range for the slide, the open zone or a drawn outline), the list of zones where the AI is unsure, and the scattered unsure cells after them. A zone is made of 31 µm grid squares with at least 3 nuclei of which at least 3 in 10 are unsure, joined edge to edge, and dropped when it has fewer than 4 unsure cells. It is named only by what the data says: the two types its cells are torn between, "second typer disagrees" or "maybe not cells". On the mock's 929 nuclei this gives two zones of 26 and 24 unsure cells and 31 scattered ones.
- The panel shows only what is selected, as Figma's properties panel does. Extras open on click, and hovering a zone or cell shows its numbers.
- The type buttons (Keep, Tumor, Stroma, Immune, Other, Not a cell) appear once, in a bar next to the selected cell. Arrow keys jump to the nearest unsure cell in that direction while a cell is selected, Shift+arrows pan, Esc steps back to the zone and then to the list, and Enter opens the cell in focus mode.
- After a few corrections the per-slide learner re-checks the slide, and the cells it changed form one more zone, "Changed after your corrections", with undo. Learning stays on the slide.
- Unsure is a neutral: white dashes with a dark casing on the slide, a hatch of #cbd5e1 (dark) or #475569 (light) in the panel. Checked is a neutral fill. Measured in the POC: at least 13.8 ΔE2000 from every class colour on the slide and 15.5 in the panel under all four visions, against 15.1 for the closest class pair, and 3:1 on every tissue pixel tested with the casing.
- Node staging from ADR 0012 stays for sentinel nodes.
- Every shortcut can be changed in Settings. The editor catches a key already used in the same scope (swap, or leave the other action without a key), keys the browser keeps, single keys for actions that change the report, and edits key sets as sets. Single-letter shortcuts can be turned off (WCAG 2.1.4), and keys match by position so a Czech keyboard keeps the layout. `?` opens this page, and there is no separate sheet.
- Upload gains two steps. "What the AI runs" starts from the lab's plan for the specimen, can be changed for the case, respects model validation and stain, and estimates time from measured throughput only. "Running" shows each slide's stages and lets the doctor open it with what is ready.

## Consequences

- REVIEW-002 now describes two findings layouts, and REVIEW-018 (zones) and REVIEW-019 (type bar and arrow jumps) are new. The gallery and focus review tasks (REVIEW-006, REVIEW-007, REVIEW-009) now work inside a zone. REVIEW-005 becomes the number line with sure and unsure parts, and REVIEW-017's verdict moves into it.
- DS-001 gains the `unsure` token, DS-002 gains the unsure thresholds and should start from the POC script, and DS-012 gains the zone row and number line.
- AILEARN-003 shows learning as the "Changed after your corrections" zone.
- CMD-003 no longer builds a sheet, CMD-006 and SET-007 describe the full editor.
- INGEST-021 gets the step header, INGEST-023 and INGEST-024 are new, and AIP-011 must report per-stage progress and throughput so the estimates have data. Until the server is timed, estimates use the one POC measurement (about 100 s per mm² of tissue at 0.5 µm per pixel on a laptop, POC doc 19) and say so.
- The pilot moves to round 4: tasks 3 to 5 test the cell findings instead of node staging, and EXP-008 follows it.
- The mock still has cells for one 40x field only, so zones at low power are a single pin. Zone rules need checking on whole-slide results (AINUC) before the thresholds are fixed.
- A pathologist should confirm that "tumor or immune" style zone names and the type hints (immune covers lymphocytes, plasma cells and histiocytes) read correctly, as part of REVIEW-000.
