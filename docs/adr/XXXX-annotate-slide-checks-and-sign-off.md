# XXXX. Annotate slide checks and sign-off per slide

- Date: 2026-11-06
- Status: Accepted
- Deciders: Claude
- Backlog: TASK-014, ANN-031, ADJ-005, COLLAB-012

## Context

[ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) has each assigned expert mark an annotate slide checked, or checked with "nothing to mark", and the task owner sign the slide off, after which the shared layer is locked and later changes go to the change log. The sign-off of review tasks locks the whole task at once ([ADR 0080](0080-disagreement-rule-and-sign-off.md), disagreement rule and sign-off), and a dataset is built slide by slide, so annotate slides need their own sign-off.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Reuse `review_assignments.submitted_at` as the checked time with a `nothing_to_mark` flag, and add `signed_off_at` and `signed_off_by_user_id` to `review_task_slides` | Slide states, My work and progress already read `submitted_at`, one small migration | "Submitted" in the schema means "checked" on annotate tasks |
| 2. A new table of checks and slide sign-offs | Names match the annotate words | Every reader of slide states would join a second source |
| 3. Sign off the whole annotate task as review tasks do | No migration | An owner could not lock finished slides while others are still drawn |

## Decision

Option 1. Migration 0094 adds the flag and the two slide columns, with checks that the flag needs a checked time and that only annotate rows carry a slide sign-off.

- `POST .../slides/{slide}/check` (with `nothing_to_mark`, refused as `layer-not-empty` when the shared layer has objects), `POST .../uncheck` and `GET .../check-status` serve the assigned experts. Both moves are refused as `slide-signed-off` once the slide is signed off.
- `POST .../slides/{slide}/sign-off` is for project owners. It is refused as `experts-unchecked` until every assigned expert has checked, and as `objects-unchecked` when the sign-off rule of [ADR 0238](0238-check-options-and-presets-on-annotate-tasks.md) (check options and presets) requires the check scope checked. Open threads do not block, and the count comes back as `open_threads` so the screen can warn (COLLAB-012).
- After sign-off every shared layer write is refused as `slide-signed-off`, except for a project owner who passes a `reason` query parameter. Without one the write is refused as `reason-needed`. Each owner change writes an `evaluation_changes` row with the object ID, the change (`added`, `edited` or `deleted`), the reason and the owner, which ADJ-005 (changes after sign-off) lists.

## Consequences

- The slide state of a signed-off annotate slide is `signed-off` while its other slides stay open.
- ANN-031 (annotate task on screen) wires the check, uncheck and sign-off buttons of the annotate task screen to these endpoints.
