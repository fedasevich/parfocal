# 0057. Cases have no state machine, and the slide pipeline per task takes its place

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-007 (revert the case state machine), supersedes [ADR 0038](0038-case-state-machine.md) for CASES-012 (case state machine)

## Context

[ADR 0038](0038-case-state-machine.md) gave every case ten sign-out states, from waiting for slides through signed and amending, moved by 14 named events with audited cancel and restore. Since [ADR 0053](0053-ai-results-review-direction.md) a case is only an optional group of slides in a project. Progress lives on each slide within a review task (TASK-002): uploaded, AI running or imported, ready, assigned, in review, submitted, in the disagreement queue, signed off and exported.

## Options considered

1. Keep the case states and map them to the task pipeline. A case can sit in several tasks at once, so one state per case cannot say where each task stands.
2. Remove the case states and build the slide pipeline per task in TASK-002.

## Decision

Option 2. `parfocal_api.case_states`, `cancelCase` and `restoreCase`, the `state`, `state_changed_at`, `cancelled_from` and `cancelled_at` columns and their checks, the state filter on `listCases`, the `state` field in case responses and the audit actions `case.state-changed`, `report.signed-out` and `report.amended` are gone. The `state` column was removed from migration `0012`, migration `0014` was deleted and `0015` now follows `0013` ([ADR 0054](0054-hospital-code-inventory-and-revert-order.md)). The `cancel-cases` permission stays in the matrix with no endpoint until ADAPT-001 (hospital-only permissions) removes it.

## Consequences

- The property tests for the state machine went with it, and so did the `hypothesis` dev dependency, which nothing else used. TASK-002 (slide states per task and reviewer) can add it back for the same kind of test.
- Folder case counts count every case that is not a draft or deleted, until ADAPT-002 (revert folders) removes them.
- Deleting or archiving a case is decided with the project model in PROJ-000 (research check).
