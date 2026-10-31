# 0120. Study templates are versioned rows in each workspace, and a review task only records the version it pins

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas (to confirm), proposed by the agent building EVAL-007 (study template model and API)
- Backlog: EVAL-007 (study template model and API), changes TASK-009 (study template in a new review task), touches TASK-004 (blinding and first read), EVAL-008 (report from template blocks) and ADMIN-008 (report template library)

## Context

[ADR 0097](0097-report-templates-built-from-blocks.md) (report templates built from blocks) decided that the evaluation report is an ordered list of blocks from a fixed catalogue, that a study template names its blocks and presets for the review task, that Parfocal ships five templates, that templates are versioned and that a task pins the version it was created with. Building the model left four questions open.

1. Are the five built-in templates shared code that every workspace reads, or rows that each workspace owns?
2. When a task is created with a template, does the API fill the task's fields from the presets, or does it only record which version the task used?
3. Opinion forms are versioned per project ([ADR 0072](0072-verdicts-reasons-and-opinion-forms.md), verdicts, reasons and opinion forms), but templates belong to the workspace. How does a template preset an opinion form?
4. What is versioned: only the blocks, or everything a researcher can change?

## Options considered

For the built-ins:

1. Code constants with a key. Nothing to seed, and a fix to a built-in reaches every workspace at once. But a workspace cannot edit or retire a built-in without a second, per-workspace layer on top, a task would pin a key and a code version instead of a row, and a code change would silently alter what old tasks pinned.
2. Rows in every workspace, seeded when the workspace is created and by the migration for workspaces that already exist. Editing, retiring and pinning work the same for built-in and own templates, and a pinned version never changes. Each workspace holds five extra templates, and a later improvement to a built-in needs a migration that adds a new version.

For the task:

1. The presets fill every task field the request leaves out. The API alone could create a task from a template. But the task then has two sources of defaults, the template and the request, and the API has to decide which wins for every field.
2. The API records only the pin. The new task stepper (TASK-009) fills its steps from the presets, the researcher changes what they want, and the request carries the final values. A changed preset is simply a different value in the request, which is what TASK-009 asks for ("Changing a preset keeps the template for the report").

For the opinion form:

1. A reference to a project form. A workspace template cannot name a form version of a project it does not know.
2. The questions inline, in the same shape as a project form, or nothing, which means the project's current form.

For versioning:

1. Version only the blocks. The name and presets could then change under a pinned task.
2. Version the whole template: name, kind of study, blocks, format and presets. Retiring is a flag on the template and is not versioned.

## Decision

- Built-ins are rows in every workspace (built-in option 2). `study_templates` holds a template's identity, its built-in key when it has one, its current version and whether it is retired, and `study_template_versions` holds every version in full. The five are seeded by `create_tenant` and, for workspaces that already exist, by migration `0044` (study templates). A researcher with admin rights may edit a built-in, which adds a version in that workspace only.
- A task records only the pin (task option 2). `createReviewTask` takes `study_template_id` and an optional `study_template_version` (the latest when left out), refuses an unknown template or version with 400 `unknown-study-template` and a retired template with 409 `study-template-retired`, and stores both on `review_tasks`. It changes no other field.
- The opinion form preset is the questions inline or `null` for the project's current form (opinion form option 2). The five built-ins use `null`.
- The whole template is versioned (versioning option 2). An edit that changes nothing returns the current version, as publishing an opinion form does.

## Consequences

- TASK-009 (study template in a new review task) fills the stepper from the presets in the browser and sends the result with the pin. When a template carries its own opinion form questions, TASK-009 publishes them as the project's next form version before creating the task, or asks the researcher. Its backlog entry says so.
- The presets are template data only. Their fields are `objects_to_check` (the task scope: kind, count and score), `opinion_form`, `blinding`, `first_read`, `start_mode` and `split`. TASK-004 (blinding and first read) decides how blinding and the first read behave on a task, and TASK-009 maps `blinding` and `first_read` onto whatever task fields TASK-004 keeps (today `blinded` and `ai_hidden_first_read`).
- A task has one scope kind, so the sentinel node template presets all regions, although the mock shows regions and a cell sample together. TODO: the owner decides whether a task may check regions and cells at once.
- TODO: the owner decides the reader study and outline quality opinion forms that the mock names, and the cell typing template's sample size (200 cells is a placeholder).
- EVAL-008 (report from template blocks) reads the block list and format from the pinned version through `parfocal_common.report_blocks`, where the catalogue lives so the renderer can validate it too.
- Fixing a built-in later means a migration that adds a version to every workspace's built-in that was not edited there.
