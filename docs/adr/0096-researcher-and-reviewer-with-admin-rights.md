# 0096. Workspace roles are researcher and reviewer, and admin is a right a researcher holds

- Date: 2026-10-20
- Status: Accepted
- Deciders: Yurii Fedas, after the supervisor meeting on 2026-10-20
- Backlog: IAM-024 (admin as a right of a researcher), changes IAM-014, ADMIN-000, ADMIN-001, ADMIN-003, ONB-004, SET-011, JOBS-005, JOBS-006, PROJ-002, HOME-009, INGEST-026 and SEC-024. Supersedes [ADR 0061](0061-researcher-reviewer-and-admin-roles.md)

## Context

[ADR 0061](0061-researcher-reviewer-and-admin-roles.md) gave a workspace three roles, researcher, reviewer and admin, with an admin who sees no slides. At the supervisor meeting on 2026-10-20 the supervisor asked for the admin and researcher roles to be joined, so that admin only adds the ability to set up the application, and for an exact definition of what each role is responsible for. A Parfocal workspace is a lab or a research group. The person who sets it up is nearly always one of its researchers, and a separate admin who cannot see the work is a hospital pattern that the AI results review direction ([ADR 0053](0053-ai-results-review-direction.md)) left behind.

## Options considered

1. Keep three roles and let one person hold two of them. Nothing changes in the code, but a membership would need several roles, and every check would have to combine them.
2. Two roles, researcher and reviewer, and every researcher gets the admin page. The simplest, but any researcher could invite people, change roles and read the audit log.
3. Two roles, researcher and reviewer, and admin rights as a flag on a researcher's membership. The person who creates the workspace gets it, at least one researcher always holds it, and giving or removing it is audited.

## Decision

Option 3, which the owner chose. `Role` becomes `researcher` or `reviewer`, and `memberships` gains `admin_rights`, which only a researcher may hold. Admin rights add the setup permissions and never add access to project data. A researcher with admin rights reaches a project's slides through a project role like any researcher, and a clinical project they are not in only through emergency access with a reason ([ADR 0066](0066-emergency-access-per-clinical-project.md)). Project roles stay as ADR 0061 set them: owner, reviewer and viewer.

### What each role is responsible for

| Who | Responsible for | Never does |
|---|---|---|
| Researcher | Runs studies. Creates projects and becomes their owner, uploads slides and AI result files, runs models, sets a project's classes, opinion form and study template, creates review tasks and invites reviewers to them, nudges and reassigns, resolves disagreements or asks an adjudicator, signs off, arranges and exports the evaluation report and shares it read-only. Can also review when a task names them | Opens a project without a project role, except clinical projects through emergency access |
| Reviewer | Reviews the slides of their tasks. Gives Agree, Disagree or Unsure on each object with optional reasons and a note, fixes outlines and types, adds missed objects, comments and mentions, fills the opinion form, submits each slide and reopens it until sign-off. Decides queued objects when a researcher makes them adjudicator | Uploads, runs models, creates projects or tasks, signs off, sees other reviewers' verdicts before submitting in a blind task, opens the admin page |
| Admin rights, on a researcher | Sets up the workspace in the admin page: invites people and sets their role and admin rights, deactivates people, archives projects and decides who may create them, shows or hides Parfocal models and connects the lab's models, connects storage and sources, issues API tokens and webhooks, keeps the workspace's report template library, reads and exports the audit log, and sets sign-in, session and two-factor rules | Sees project data because of the right. Removes the right from the last person who holds it |
| Project owner | Manages one project: its members and their project roles, its settings, its tasks and their sign-off | |
| Project reviewer | Sees only the slides of their tasks in that project | |
| Project viewer | Reads the project's slides, results and reports without giving verdicts | |
| Adjudicator | Not a role. A reviewer or researcher whom a researcher asks to decide queued objects in one task, with the reviewers anonymous | |

### Permission matrix

| Permission | Researcher | Reviewer | Added by admin rights |
|---|---|---|---|
| `see-slides` | Yes, with a project role | In their tasks | Nothing |
| `emergency-access` | Emergency, with reason | No | Nothing |
| `create-cases` | Yes | No | Nothing, unless the workspace limits project creation to admin rights |
| `upload-slides`, `move-slides` | Yes | No | Nothing |
| `review` | Yes | In their tasks | Nothing |
| `set-own-status` | Yes | Yes | Nothing |
| `see-people` | Yes | View only | Nothing |
| `manage-people` | No | No | Yes |
| `workspace-settings` | View only | No | Yes |
| `integrations` | View only | No | Yes |
| `report-templates` | Use | No | Edit the library |
| `audit-log` | No | No | Yes |
| `developer-mode` | Yes | No | Nothing |

## Consequences

- IAM-024 is new. It removes `admin` from `Role`, migrates every admin membership and invitation to a researcher with admin rights, adds the flag to invitations, guards against removing the last holder, and regenerates the [permission page](../reference/permissions.md). The table-driven permission test gains a column for a researcher with admin rights.
- The admin page stays its own page (ADMIN-001), opened by researchers with admin rights. Its People and roles section shows two roles and an admin rights switch (ADMIN-003).
- First-run setup gives admin rights to the person who creates a workspace (ONB-004).
- "An admin" in JOBS-005, JOBS-006, PROJ-002, SET-011, HOME-009, INGEST-026 and SEC-024 now means a researcher with admin rights.
- The kit's Roles page, the people section of the admin page and POC doc 43 describe the same responsibilities, and the supervisor sees the admin page in the next meeting.
