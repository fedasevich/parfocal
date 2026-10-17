# Permissions

Generated from `apps/api/src/parfocal_api/permissions.py` by `pnpm permissions:doc`.
Edit the matrix there, never this page. The matrix follows the UX kit's Roles and access page, and [ADR 0026](../adr/0026-roles-and-permission-matrix.md) explains it.

## Roles

| Key | Role |
|---|---|
| `consultant` | Consultant pathologist |
| `resident` | Resident |
| `lead` | Lab lead or head of department |
| `lab` | Lab staff |
| `admin` | Administrator |

Platform operators sit outside the matrix and only reach `/api/platform/*`.

## Matrix

An empty cell means no.

| Action | Key | Consultant pathologist | Resident | Lab lead or head of department | Lab staff | Administrator |
|---|---|---|---|---|---|---|
| See cases | `see-cases` | Yes | Yes | Yes | View only |  |
| Open a case their role does not reach | `emergency-access` |  |  |  |  | Emergency, with reason |
| Create a case, edit its details | `edit-cases` | Yes |  | Yes | Yes |  |
| Upload slides, fix unmatched slides | `upload-slides` | Yes | Yes | Yes | Yes |  |
| Move a slide between cases | `move-slides` | Assigned to them |  | Yes | Yes |  |
| Make calls, measure, annotate | `annotate` | Assigned to them | Assigned to them | Assigned to them |  |  |
| Set their own status and absence | `set-own-status` | Yes | Yes | Yes | Yes | Yes |
| See the Team page and rota | `see-team` | View only | View only | Yes | View only | Yes |
| Invite people, change roles | `manage-people` |  |  | Yes |  | Yes |
| Lab setup: rules, due times, AI plan, templates | `lab-setup` |  |  | Yes |  | View only |
| Integrations and upload sources | `integrations` |  |  | View only |  | Yes |
| Audit log | `audit-log` |  |  | View only |  | Yes |
| Developer mode | `developer-mode` |  |  |  |  | Yes |
