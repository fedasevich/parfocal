# 0415. A review task's final layer is an append only snapshot per slide

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-118 (a signed off review task becomes a final layer the dataset builder reads)

## Context

Decision 166 (which task carries training data) chose option A. A signed off review task is turned into a final layer that the existing dataset builder reads, so a doctor's corrections become training data. Decision 170 (which objects go into a dataset by default) chose option A, only objects a person checked, with unsure and open objects left out and counted. The builder in `training_exports.py` read only the shared layer of an annotate task in `annotations`, and `annotate_only` refused review tasks in the dataset, the dataset versions and the patch export.

## Options considered

- Rows in `annotations` under the review task. The builder would read them unchanged, but `annotations` with the review task's id already means "added by a reviewer" to the reviewer layer, the consensus export, `first_of_each_match` and the evaluation, and PROTO-119 (shapes drawn in a review task belong to the task) adds more such rows. Final copies there would be counted twice and look like added objects.
- Computing the layer at every export. No storage, but the dataset would change whenever a late decision changes, and nothing would record what the sign off produced.
- A new table holding one snapshot per slide and build. Append only like `review_edit_versions` and `dataset_versions`, readable without touching the reviewer tables.

## Decision

- Migration 0148 adds `final_layers` with one row per task, slide and build: `task_version` (the signed evaluation version), `objects` as JSON, `counts`, who built it and when. The app role may only select and insert.
- Signing off a review task builds the layer in the same transaction. `POST /api/review-tasks/{task}/final-layer` builds it again from the Dataset page, which is needed after a decision changed after sign off and for tasks signed off before this change.
- The rule per AI object follows `engine.consensus`, so the layer matches the evaluation. Agreed with no change is `ai-confirmed`, author the adjudicator or the first reviewer who agreed. Agreed with a settled outline, a redraw or a retype is `ai-edited`, shape from the settled outline, then the earliest redraw, class from the adjudicator's class answer, then the earliest retype, author whose shape or class won. A unanimous disagree with a redraw, a retype or one wrong class reason is also `ai-edited`. An adjudicated disagree counts only the adjudicator's outline or class as a fix. Any other disagree is a deletion. Unsure and undecided objects, left open ones included, are stored as unsure or open and left out.
- Added objects are the task's `annotations` rows, one per match as in the consensus export, as `human` with their author.
- Geometry is stored only where it differs from the AI. The reader takes the AI shape from the result set otherwise.
- The builder reads the newest build. It refuses with `final-layer-missing` when there is none or when the build's version is older than the signed version. Unsure and open objects count as covered, so "include unchecked" never pulls them in, and the manifest, the dataset summary and each slide gain `unsure_left_out` and `open_left_out`. The manifest stays format 2.

## Consequences

- One dataset builder serves both kinds of task, so the zip, the frozen versions and the patches work for review tasks with no second reader.
- Splits and merges from `review_edits` are not in the final layer, as they are not in the consensus export. They are left for the split and merge task.
- A reviewer's delete in their own layer has no effect on the final layer. Only decisions decide a rejection.
- A build is never rewritten, so every frozen dataset version can be traced to the build that fed it.
