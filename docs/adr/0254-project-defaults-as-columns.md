# 0254. Project defaults for new tasks and ID matching are typed columns on projects, changed through the project PATCH

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: PROJ-008 (project settings)

## Context

PROJ-008 (project settings) makes the Settings tab real. The project needs blind review and hide the AI for a first read as defaults for new tasks, a default study template, the region IoU and cell distance that carry IDs across result sets ([ADR 0071](0071-object-id-grammar.md), object ID grammar), and in a clinical project the report template, whose column REPORT-024 (clinical report model and API) already added.

## Options

1. Typed columns on `projects`, changed through the existing `PATCH /api/projects/{id}`, which already audits `project.changed` with the field names.
2. One JSONB `settings` column with its own endpoint and audit action.

## Decision

Option 1. Migration 0096 adds `blinded`, `ai_hidden_first_read`, `study_template_id` (a foreign key to `study_templates`), `match_iou` (above 0, at most 1, default 0.5) and `match_distance_um` (above 0, at most 50, default 4). They mirror the columns `review_tasks` already has, check constraints guard them, and every change lands in the one audit entry the PATCH writes. The clinical report template is refused in a de-identified project with `clinical-template-only`, and a retired or unknown study template with `study-template-unknown`.

A new review task takes `blinded`, `ai_hidden_first_read` and the study template from the project when the draft leaves them out, and the study template still presets the decision style and the display defaults and locks ([ADR 0132](0132-display-settings-presets-and-task-locks.md), display settings, presets and task locks), so the project stores none of those itself. A retired default template is skipped.

## Consequences

- The matching workers do not read the two thresholds yet. TODO: pass them to `parfocal_ingest.matching` in a follow-up task.
- A further project setting is one column and one `ProjectChange` field.
