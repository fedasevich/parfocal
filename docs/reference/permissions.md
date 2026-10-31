# Permissions

Generated from `apps/api/src/parfocal_api/permissions.py` by `pnpm permissions:doc`.
Edit the matrix there, never this page. [ADR 0096](../adr/0096-researcher-and-reviewer-with-admin-rights.md) explains it.

## Roles

| Key | Role | Responsible for |
|---|---|---|
| `researcher` | Researcher | Runs studies. Creates projects and owns them, uploads slides and AI result files, runs models, sets a project's classes, opinion form and study template, creates review tasks and invites reviewers, resolves disagreements, signs off and exports the evaluation report. Reviews when a task names them. Opens a clinical project without a project role only through emergency access |
| `reviewer` | Reviewer | Reviews the slides of their tasks. Gives verdicts with reasons and notes, fixes outlines and types, adds missed objects, fills the opinion form and submits each slide. Decides queued objects when a researcher makes them adjudicator. Never uploads, runs models, creates projects or tasks, signs off or holds admin rights |

Platform operators sit outside the matrix and only reach `/api/platform/*`.

## Admin rights

Admin rights are the `admin_rights` flag on a researcher's membership or invitation. They are a right and not a role, and a reviewer never holds them. A holder sets up the workspace: invites people and sets their role and admin rights, changes workspace and session settings, connects storage, sources, API tokens and webhooks, keeps the report template library, and reads and exports the audit log. Admin rights add no access to project data, and a workspace always keeps at least one holder.

## Project roles

A member reaches a project only with one of these roles. Service accounts reach every project of their workspace through their scopes.

| Key | Project role |
|---|---|
| `owner` | Owner, manages the project, its people and its tasks |
| `reviewer` | Reviewer, sees only the slides of their tasks |
| `viewer` | Viewer, reads the project |

Inside a project the narrower of the workspace grant and the project grant applies. A workspace grant of in their tasks with a project grant of yes reads the project without changing it.

| Action | Key | owner | reviewer | viewer |
|---|---|---|---|---|
| See projects, cases and slides | `see-slides` | Yes | In their tasks | Yes |
| Create projects and cases, edit their details | `create-cases` | Yes |  |  |
| Upload slides and AI results, fix unmatched files | `upload-slides` | Yes |  |  |
| Move a slide between cases | `move-slides` | Yes |  |  |
| Run AI models on slides, cancel, resume and retry the runs | `run-models` | Yes |  |  |
| Give verdicts, fix results, comment | `review` | Yes | In their tasks |  |

## Matrix

An empty cell means no. A researcher with admin rights gets the researcher's column and yes wherever the admin rights column says yes.

| Action | Key | Researcher | Reviewer | Added by admin rights |
|---|---|---|---|---|
| See projects, cases and slides | `see-slides` | Yes | In their tasks |  |
| Open a clinical project they are not in | `emergency-access` | Emergency, with reason |  |  |
| Create projects and cases, edit their details | `create-cases` | Yes |  |  |
| Upload slides and AI results, fix unmatched files | `upload-slides` | Yes |  |  |
| Move a slide between cases | `move-slides` | Yes |  |  |
| Run AI models on slides, cancel, resume and retry the runs | `run-models` | Yes |  |  |
| Give verdicts, fix results, comment | `review` | Yes | In their tasks |  |
| Set their own status | `set-own-status` | Yes | Yes |  |
| See the workspace's people and their status | `see-people` | Yes | View only |  |
| Invite people, change roles and admin rights | `manage-people` |  |  | Yes |
| Workspace settings and session security | `workspace-settings` | View only |  | Yes |
| Storage, sources, API and webhooks | `integrations` | View only |  | Yes |
| Use report templates, edit the library | `report-templates` | View only |  | Yes |
| Audit log | `audit-log` |  |  | Yes |
| Developer mode and API tokens | `developer-mode` | Yes |  |  |
