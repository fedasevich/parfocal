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
| `outside-consultant` | Outside consultant |
| `admin` | Administrator |

Outside consultants never hold a membership. They act through a guest link (IAM-010).
Platform operators sit outside the matrix and only reach `/api/platform/*`.

## Matrix

An empty cell means no. Actions marked by folder apply only inside the folders a person works in once IAM-016 adds folders, and to the whole workspace until then.

| Action | Key | Consultant pathologist | Resident | Lab lead or head of department | Lab staff | Outside consultant | Administrator |
|---|---|---|---|---|---|---|---|
| See cases (by folder) | `see-cases` | In their folders | In their folders | Yes | View only | Shared with them |  |
| Open a case outside their folders | `open-outside-folders` | Emergency, with reason | Emergency, with reason | Yes |  |  | Emergency, with reason |
| Create a case, edit its details (by folder) | `edit-cases` | In their folders |  | Yes | Yes |  |  |
| Upload slides, fix unmatched slides (by folder) | `upload-slides` | Yes | Yes | Yes | Yes |  |  |
| Move a slide between cases (by folder) | `move-slides` | Assigned to them |  | Yes | Yes |  |  |
| Cancel a case | `cancel-cases` |  |  | Yes |  |  |  |
| Take or hand off their own cases (by folder) | `take-cases` | Yes | Assigned to them | Yes |  |  |  |
| Reassign anyone's case | `reassign-cases` |  |  | Yes |  |  |  |
| Make calls, measure, annotate (by folder) | `annotate` | Assigned to them | Assigned to them | Assigned to them |  | Measure, comment |  |
| Order lab work (by folder) | `order-lab-work` | Assigned to them | Assigned to them | Yes |  |  |  |
| Draft the report | `draft-reports` | Assigned to them | Assigned to them | Assigned to them |  |  |  |
| Sign out | `sign-out` | Assigned to them | Needs co-sign | Assigned to them |  |  |  |
| Co-sign a resident's report | `co-sign` | As named supervisor |  | Yes |  |  |  |
| Amend or add an addendum | `amend-reports` | Assigned to them |  | Yes |  |  |  |
| Ask for a second opinion (by folder) | `ask-second-opinion` | Assigned to them | Assigned to them | Yes |  |  |  |
| Give a second opinion | `give-second-opinion` | Yes |  | Yes |  | Shared with them |  |
| Share a signed report outside | `share-reports` | Assigned to them |  | Yes |  |  |  |
| Prepare and present a tumor board (by folder) | `tumor-boards` | Yes | Yes | Yes |  |  |  |
| Set their own status and absence | `set-own-status` | Yes | Yes | Yes | Yes |  | Yes |
| See the Team page and rota (by folder) | `see-team` | View only | View only | Yes | View only |  | Yes |
| Invite people, change roles and folders | `manage-people` |  |  | Yes |  |  | Yes |
| Lab setup: rules, due times, AI plan, templates | `lab-setup` |  |  | Yes |  |  | View only |
| Approve a model for a specimen | `approve-models` |  |  | Yes |  |  |  |
| Integrations and upload sources | `integrations` |  |  | View only |  |  | Yes |
| Audit log | `audit-log` |  |  | View only |  |  | Yes |
| Developer mode | `developer-mode` |  |  |  |  |  | Yes |
