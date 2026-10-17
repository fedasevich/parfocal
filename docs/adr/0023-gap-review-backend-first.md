# 0023. Gap review: one case state model, cases from the LIS first, roles narrowed by folders, team control, and backend before UI

- Date: 2026-10-10
- Status: Superseded by 0053
- Deciders: Yurii Fedas
- Backlog: CASES-012 to CASES-024, NOTIF-008, IAM-016 to IAM-020, SEC-024, REPORT-018 to REPORT-023, AIP-016, AIP-017, COLLAB-013, COLLAB-014, NOTIF-006, NOTIF-007, BOARD-013, TEAM-000 to TEAM-006, TB-000 to TB-004, and edits to CASES-002, BOARD-002, REPORT-010 and HOME-009

## Context

A gap review of the prototype pair walked every screen, flow and promise and found 25 dead ends, places where a screen promised something no screen delivered. Examples are a resident's case waiting for "Supervision" with no supervisor screen, a reassign picker that shows absences and back-ups that nothing sets, "lock after 15 minutes" with no lock screen, notification switches with nowhere for notifications to collect, and no way to create a case, move a misfiled slide or handle a report the LIS rejects. The UX kit gained ten pages, wireframes W39 to W73 and Flows 9 to 30 (UX kit version 14). The owner asked for the backlog to carry what the product must do for these, without tying it to screens that may still change a lot.

## Options considered

1. Add backend tasks now (models, rules, APIs, events, tests) and add UI tasks only when the prototype's screens for them settle. Work can start on the parts that do not move, and nothing is built twice when a screen changes.
2. Add full tasks, backend and UI, from the wireframes. Complete on paper, but the wireframes are one round old and some have open options (three case creation forms, three permission models, three Team views), so UI tasks would be rewritten.
3. Wait until the hi-fi mock covers everything. Nothing to rewrite, but the backend work, which does not depend on layout, would wait too.

## Decision

Option 1. The design choices behind the new tasks, as proposed in the kit:

- One case state model behind the worklist, the board, the report and outgoing messages, including waiting for slides, with the supervisor, amending and cancelled (CASES-012).
- Cases come from the LIS when there is one, and fields the LIS owns are read-only in the app. Manual creation covers consults, research, teaching and labs without a LIS link (CASES-013, CASES-014).
- Six roles narrowed by the folders a person works in, rather than fixed roles or custom permission sets. Emergency access outside the folders needs a reason and is audited, and administrators see no patient data by default (IAM-016, IAM-017).
- Residents never sign alone. The supervisor co-signs and their edits are kept as changes (IAM-018, REPORT-019).
- Outside consultants sign in with an emailed one-time code and see only what is shared with them (IAM-019, COLLAB-013, COLLAB-014).
- Signing has a short undo window before the report leaves, and delivery goes through an outbox that survives the LIS being down (REPORT-018, REPORT-022).
- Only the assignee edits calls and the report at a time, through a lease (REPORT-021).
- Every notification is a deep link to the exact place (NOTIF-006), and nothing is shown while a slide is open, STAT included (NOTIF-008).
- New case is the main button outside a case and also takes slides: each dropped file goes to its case by label, unknown labels fill the new case and a requisition fills the form. A separate Upload button goes away. The menu and drop-on-a-row alternatives stay in the prototype for testing (CASES-024).
- Team control (absences, capacity, bulk reassign, hand-over) and tumor boards get their own epics, TEAM and TB.

How a report is signed (password again, a qualified electronic signature or a badge) stays open and is a question for the supervisor, so SEC-023 is unchanged.

## Consequences

- 45 tasks were added, bringing the backlog to 603 tasks in 40 epics. SHELL-002 now has New case as the main entry and NOTIF-003 holds back while a case is open. CASES-002 now depends on CASES-013, BOARD-002 on CASES-012, HOME-009 on TB-001, and REPORT-010 spells out the addendum.
- "How to use" says gap-review tasks are backend first and that no backend task may depend on a layout.
- The hi-fi mock shows the new screens as steps 23 to 35. UI tasks for them are added in a later backlog edit, once their open options are chosen.
