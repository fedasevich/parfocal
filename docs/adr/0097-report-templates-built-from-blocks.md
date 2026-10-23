# 0097. The evaluation report is built from blocks, and study templates preset a review task and its report

- Date: 2026-10-20
- Status: Accepted
- Deciders: Yurii Fedas, after the supervisor meeting on 2026-10-20
- Backlog: EVAL-007 (study template model and API), EVAL-008 (report from template blocks), EVAL-009 (arrange one report), ADMIN-008 (report template library), TASK-009 (study template in a new review task), changes EVAL-002, EVAL-003, ADJ-004, PROJ-008 and SET-011

## Context

The evaluation report (EVAL-002) has a fixed layout: headline numbers, the cell type confusion matrix, disagreement reasons, the opinion answers and the objects that went worst. At the supervisor meeting on 2026-10-20 the supervisor asked for the report to be configurable "like lego", as the hospital direction's report templates were ([ADR 0022](0022-sign-out-report-standards-and-pdf-preview.md), [ADR 0045](0045-forms-and-validation.md)), with report templates for kinds of study in the interface, the mock and the backlog. Studies differ in what they need. A detection study cares about region sensitivity and precision, a segmentation study about Dice, a cell typing study about the confusion matrix and cell agreement, and a reader study about agreement between reviewers before they see the AI. The PDF is rendered by Typst from the evaluation JSON, and the web page is a React page that reads the same JSON ([ADR 0083](0083-typst-for-report-pdfs.md)).

## Options considered

1. Keep one fixed report. Nothing to build, but every study gets blocks it does not need and lacks the ones it does.
2. A report is an ordered list of blocks from a fixed catalogue, each with a few settings, and a study template names the blocks together with the task presets. The web page and the PDF render the same list, so they stay in step.
3. A free document editor with charts embedded in rich text. The most flexible, but the PDF and the web page drift apart, and numbers typed into text stop matching the data.

## Decision

Option 2, as the owner chose in the interview.

- A block is a kind from a fixed catalogue with its settings. The catalogue is: headline numbers (which metrics), region metrics per slide, cell type confusion matrix, agreement between reviewers, disagreement reasons, opinion answers (which questions), objects worst first (how many), per-slide table, a slide figure with the reviewed layer (which slide and object), a text block for methods or notes, and comparison with another result set. The header with the version and the model and data line at the foot are always there, and so is the list of changes after sign-off when there are any.
- A study template has a name, a kind of study, its blocks in order and presets for the review task: the objects to check, the opinion form, blinding, hiding the AI for a first read, where reviewers start and the split. Parfocal ships five templates: detection, segmentation, cell typing, reader study and sentinel node AI evaluation. Templates are versioned, and a task pins the version it was created with.
- The workspace keeps its library of study templates in the admin page. Researchers with admin rights ([ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md)) add, edit, duplicate and retire templates there. Every researcher picks a template when creating a review task and can set a project's default.
- A researcher can arrange one task's report: add, remove and reorder blocks and change their settings. The arrangement belongs to that task and never changes the template, and "Save as template" offers it to the library.
- Signing off records the block list with the evaluation version and its checksum, so a signed report always renders as it was signed. A later change to the layout is logged like any change after sign-off.
- The web report and the Typst PDF render the same block list from the same evaluation JSON. A block with nothing to show, such as a confusion matrix in a task with no cells, says so instead of disappearing.

## Consequences

- EVAL-007 adds templates, their versions and the built-in five, with the library API. EVAL-008 makes EVAL-002's page and EVAL-003's PDF render a block list. EVAL-009 adds arranging one report. ADMIN-008 is the library section of the admin page with the block editor. TASK-009 adds the template to the new review task and fills its steps from the presets.
- ADJ-004 (sign-off) stores the block list with the evaluation version. PROJ-008 (project settings) gains the default template. SET-011 lists templates among the workspace defaults.
- EVAL-010 is the PDF preview of a task's report and of a template with sample numbers.
- The kit gains a Study templates page and the mock gains the admin section, the template editor as pages with blocks, the template choice in the task, the report shown as its pages and the PDF preview.
