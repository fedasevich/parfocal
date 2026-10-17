# 0053. Parfocal becomes an AI results review app, with the hospital sign-out workflow kept as ideas

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: new epics PROJ, RSET, OBJ, TASK, GUIDE, ADJ, EVAL, JOBS, REMOTE, ONB, ADMIN, VIZ and ADAPT, new tasks IAM-022, DS-018 to DS-022, CASE-014 and CASE-015, WL-018 and WL-019, edits across SKEL, IAM, SEC, INGEST, DS, SHELL, HOME, WL, CASE, REVIEW, ANN, COLLAB, CASES, AIP, NOTIF, SET, CMD, EXP and PILOT, and the REPORT, BOARD, TEAM and TB epics moved to ideas

## Context

The backlog was written for a hospital-wide sign-out platform: a worklist of cases, a status board, tumor boards, supervisor co-sign, a synoptic clinical report, LIS and FHIR intake. In a design interview on 2026-10-15 the owner changed the product's direction. Parfocal becomes a viewer of AI results. Researchers import or run AI on whole slides and evaluate what a model marked (tumor regions, cells, unsure zones). Doctors review those results, fix them, comment and give an opinion. The viewer stays. The hospital workflow is kept only as ideas for consideration.

The decisions are written in the POC as [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md). Three feedback rounds on the rebuilt prototype followed on 2026-10-16 and 2026-10-17 ([doc 38](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/38-ui-feedback-round-2.md), [doc 39](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/39-ui-feedback-round-3.md), [doc 41](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/41-clickable-pass.md)), together with a UI and UX audit ([doc 40](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/40-ui-ux-audit.md)). The UX kit (version 25) and the hi-fi mock (version 39) now show the new product, and the owner asked for the backlog to carry everything that has to be built for it.

Part of the hospital work is already built: the patient and case model with encrypted identifiers (CASES-001, SEC-004), accession numbers (CASES-004), the case state machine (CASES-012), folder-scoped roles (IAM-016), emergency access (IAM-017) and signing rights (IAM-018).

## Options considered

1. Keep the hospital backlog and add the new work beside it. Nothing is lost, but the backlog would describe two products, and agents would keep picking hospital tasks such as the status board or the LIS adapter.
2. Rewrite the backlog for the new direction and delete the hospital tasks. The backlog would be short and honest, but task IDs must never change or disappear, the built code would lose its planning trail, and the owner wants the hospital screens kept as ideas.
3. Plan the new direction and keep the hospital work as ideas. New epics carry the new product. Tasks that only serve the hospital workflow keep their IDs and text, are marked as ideas and leave the milestones. Tasks that still apply are edited to the new model. Built hospital code is reverted or reworked by new tasks, so nothing is left running that the product does not use.

## Decision

Option 3, with these product rules, all from doc 37 to doc 41.

| Topic | Rule |
| --- | --- |
| Product | A viewer where researchers evaluate AI results on whole slides and doctors review them. Parfocal shows its own logo slot next to the workspace's name and logo |
| Roles | Researcher, reviewer and admin in the workspace, and owner, reviewer and viewer per project |
| Data | Project, then an optional case, then slide, then result sets. Loose slides sit directly in a project |
| Privacy | Each project is de-identified (the research default, no patient fields anywhere, names stripped on upload) or clinical (patient fields allowed and optional, hidden names, logged access) |
| AI results | Importing results made elsewhere is first class: Parfocal JSON, GeoJSON including QuPath, CSV or TSV with column mapping, and masks or heatmaps. Built-in and lab models run on demand as model runs. Every import or run is a result set with its model, version, date and source. Reviewer edits go into a separate reviewed layer |
| IDs | Short IDs per slide (T2, T2·C145, C3021, R4, Z1, M1) with a full path for links and exports (`P07/S26-04812/A1/T2·C145`), carried across result sets by overlap |
| Review | A researcher creates a review task with slides, a result set, reviewers, a split, a scope, an opinion form, blinding and a due date. Reviewers answer Agree, Disagree or Not sure per object in guided review or in the full viewer, with an undo after every answer |
| Pipeline | Uploaded, AI running or imported, ready, assigned, in review, submitted, disagreement queue, signed off, exported. Sign-off is a soft lock with a change log |
| Output | An evaluation report per task, marked as a research output, with exports in PDF, CSV, JSON and GeoJSON |
| Sources | Upload, link import, read in place from a connected source, a webhook per project and events out |
| Interaction | A control responds only when clicking it changes something in the flow. The bell is the only place for mentions, replies, tasks and jobs |
| Design system | Nine tag types, five icon sizes (12, 16, 20, 24, 40) and nine type sizes (11 to 28), with running text never under 12 px, as the UX kit page "UI kit: tags, icons and type" shows |
| Ideas | Status board, tumor boards, team rota and capacity, the clinical sign-out report and PDF, supervisor co-sign, free-text reports, the consultant side of a second opinion, LIS and FHIR intake, accession rules, the STAT banner and the department dashboard are ideas. They keep their IDs and are not planned |

Built hospital work is reverted or reworked, never left unused. The owner asked on 2026-10-17 for tasks that do this, so a new ADAPT epic holds one task per built module. Roles, cases and case creation, emergency access, availability and patients are reworked for projects. Folders, accession numbers, the case state machine, routing rules and signing rights are reverted. Each task supersedes the ADR it undoes, and the ticked tasks that built the code stay ticked as history.

## Consequences

- The backlog gained thirteen epics (PROJ, RSET, OBJ, TASK, GUIDE, ADJ, EVAL, JOBS, REMOTE, ONB, ADMIN, VIZ and ADAPT) and new tasks in IAM, DS, CASE and WL.
- ADAPT runs first in M3, before PROJ and TASK build on cases and roles. Until it lands, the hospital endpoints stay as they are and nothing new may depend on folders, accession numbers, case states, routing or signing rights.
- [ADR 0035](0035-fhir-r4-through-fhir-resources-r4b.md) (FHIR) needs no revert, because the spike added no code. It stays Accepted for the FHIR idea.
- The REPORT, BOARD, TEAM and TB epics have the milestone Idea, and single hospital tasks in other epics have titles that start with `Idea:`. "How to use" says not to start an idea unless the owner asks and never to make a planned task depend on one.
- WL becomes My work, CASE becomes the slide view with Objects, Layers, Comments and Opinion tabs, and sentinel-node staging becomes a project analysis template (PROJ-005), so REVIEW keeps its staging tasks.
- The milestones were redefined. M1 now ends with a verdict and a submitted review instead of a signed stub report, M3 is the review loop, M4 adds model runs and visualization, and M5 adds disagreements, sign-off and the evaluation report.
- The product KPIs now name review tasks instead of sign-out.
- The CASES-025 claim (folder screens) was released, because folders are now an idea.
- UI tasks still wait for the owner to say the UI is final, as the board claims say.
