# Permissions

Generated from `apps/api/src/parfocal_api/permissions.py` by `pnpm permissions:doc`.
Edit the matrix there, never this page. [ADR 0061](../adr/0061-researcher-reviewer-and-admin-roles.md) explains it.

## Roles

| Key | Role |
|---|---|
| `researcher` | Researcher |
| `reviewer` | Reviewer |
| `admin` | Admin |

Platform operators sit outside the matrix and only reach `/api/platform/*`.

## Project roles

A member also holds one of these in each project they are in. PROJ-003 enforces them.

| Key | Project role |
|---|---|
| `owner` | Owner, manages the project, its people and its tasks |
| `reviewer` | Reviewer, sees only the slides of their tasks |
| `viewer` | Viewer, reads the project |

## Matrix

An empty cell means no.

| Action | Key | Researcher | Reviewer | Admin |
|---|---|---|---|---|
| See projects, cases and slides | `see-slides` | Yes | In their tasks |  |
| Open a case their role does not reach | `emergency-access` |  |  | Emergency, with reason |
| Create projects and cases, edit their details | `create-cases` | Yes |  |  |
| Upload slides and AI results, fix unmatched files | `upload-slides` | Yes |  |  |
| Move a slide between cases | `move-slides` | Yes |  |  |
| Give verdicts, fix results, comment | `review` | Yes | In their tasks |  |
| Set their own status | `set-own-status` | Yes | Yes | Yes |
| See the workspace's people and their status | `see-people` | Yes | View only | Yes |
| Invite people, change roles | `manage-people` |  |  | Yes |
| Workspace settings and session security | `workspace-settings` | View only |  | Yes |
| Storage, sources, API and webhooks | `integrations` | View only |  | Yes |
| Audit log | `audit-log` |  |  | Yes |
| Developer mode and API tokens | `developer-mode` | Yes |  | Yes |
