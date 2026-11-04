# 0233. The server keeps each reviewer's display per task and stamps the preset in force on every decision

- Date: 2026-11-04
- Status: Proposed
- Deciders: Claude, for the owner to confirm
- Backlog: TASK-011 (display defaults, locks and presets)

## Context

[ADR 0132](0132-display-settings-presets-and-task-locks.md) (display settings, presets and task locks) says every decision stores the preset in force and the API refuses a reviewer's change to a locked value. Both need the API to know what a reviewer has on screen. The data shape is costly to change once decisions carry a preset.

## Options considered

1. The client sends the preset name with each decision. Nothing else is stored, but the API cannot check a locked value, and a wrong or stale name lands in the report.
2. The server keeps each reviewer's display for a task, the settings and the preset picked, in `display_choices`. A change to a locked value is refused there, and saving a decision copies the picked preset's name onto the decision row.
3. As option 2, but the decision keeps the preset's id. A rename would then show the new name in old reports, and a deleted preset would leave no name at all.

## Decision

Option 2.

- `review_tasks.display` holds the task's defaults and its locks, each with a reason of 5 to 120 characters. The study template's `presets.display` fills it when the New review task flow sends none.
- `display_presets` holds a reviewer's presets, with a name of 1 to 40 characters that is unique per person and workspace, ignoring case, for one task (`task_id`) or for all their tasks (no task). "Task default" is reserved.
- `display_choices` holds what each reviewer has picked on a task. `PUT /api/review-tasks/{task_id}/my-display` refuses a locked value that differs from the task's with `display-setting-locked`, and so does saving or changing a preset for one task.
- The decision row's new `preset` column copies the picked preset's name when the decision is saved. No name means the task default. Renaming or deleting the preset later leaves the decision as it was.
- The evaluation returns the task's display and, per reviewer and preset, how many objects were decided.

## Consequences

- The Display panel (VIZ-007) saves the reviewer's choice before the next decision, or the decision records the earlier choice.
- The web's `getTaskDisplay` draft guessed a different shape on `/api/review-tasks/{task_id}/display`. VIZ-007 replaces it with `getMyDisplay` and the preset operations.
- A preset for all tasks may hold values another task locks. Applying it keeps the lock on the client, as ADR 0132 says.
