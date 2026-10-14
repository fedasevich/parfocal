# 0038. Case state machine: named events with allowed actors, derived moves by the system, cancel and restore by leads

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: CASES-012, CASES-001, REPORT-019, REPORT-010, BOARD-002, INGEST-001, AIP-001

## Context

CASES-012 (case state machine) asks for one state model behind the worklist, the board, the report and outgoing messages, with the actors who may make each transition, derived states moved by data and the rest by people. Its test must cover every allowed and refused transition with its actor and prove that every state is reachable and that "signed" is reached only by signing. The UX kit's "Case lifecycle and data" page lists ten states, their owner and what makes a case leave each one. [ADR 0036](0036-case-data-model.md) stores the state on the case.

## Options considered

1. Let any code set the state column. Simple, but nothing stops a case from jumping to "signed" or back.
2. A transition table keyed by state pairs. Says what may follow what, but not why or who did it, which the audit log and notifications need.
3. Named events, each with the states it may start from, the state it leads to and the kinds of actor who may cause it. The event name is what the audit log records and what feature code calls.

## Decision

Option 3, in `parfocal_api.case_states`.

| Event | From | To | Actor |
|---|---|---|---|
| slides matched | waiting for slides | waiting for AI | system |
| AI finished | waiting for AI | ready to review | system |
| opened | ready to review | in review | assignee |
| sub-task opened | in review | waiting on others | system |
| sub-tasks closed | waiting on others | in review | system |
| draft saved | in review | report drafted | assignee |
| signed out | report drafted | signed | assignee |
| sent for review | report drafted | with the supervisor | assignee |
| co-signed | with the supervisor | signed | supervisor |
| returned | with the supervisor | in review | supervisor |
| amendment started | signed | amending | signer or lead |
| amendment signed | amending | signed | signer or lead |
| cancelled | any open state | cancelled | lead |
| restored | cancelled | the state before cancelling, within 30 days | lead |

- "System" events are the derived ones: the tasks that own slides, AI runs and sub-tasks call them when their data changes.
- Signed and amending cases cannot be cancelled. A check constraint also refuses a cancelled case without the state it came from.
- `move_case` locks the case, applies the event, records `case.state-changed` with the event, both states and the actor kind, and refuses with `case-wrong-state` or `case-wrong-actor`.
- `POST /api/cases/{id}/cancel` and `/restore` need "cancel a case", which only leads hold.

## Consequences

- The kit lets lab staff cancel a case while it waits for slides, but the permission matrix gives "cancel a case" to leads only ([ADR 0026](0026-roles-and-permission-matrix.md)). The matrix wins. TODO: the owner decides whether lab staff should cancel cases that are still waiting for slides.
- Which person counts as assignee, supervisor or signer is decided by the feature that calls the event, using the case's assignee and the signing rights of [ADR 0032](0032-signing-rights-on-the-membership.md).
- Priority and due time stay attributes, as the kit says, so STAT never changes the state.
