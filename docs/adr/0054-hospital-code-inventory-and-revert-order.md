# 0054. The built hospital code is reverted first, then the roles change, then cases move into projects, with migrations edited in place

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: closes ADAPT-000 (inventory and plan), edits ADAPT-001 to ADAPT-011, IAM-022 (researcher, reviewer and admin roles) and PROJ-001 (project model and API)

## Context

[ADR 0053](0053-ai-results-review-direction.md) turned Parfocal into an AI results review app and asked for the hospital code built so far to be reverted or reworked, never left unused. ADAPT-000 has to list every endpoint, table, column and permission that the hospital tasks added, mark each one, and order the work so every step leaves `main` green.

Three facts shape the plan.

- Migrations `0010` to `0019` only ever ran on local databases and on CI's fresh databases. Cloud work stopped on 2026-10-08 ([knowledge/platform.md](../knowledge/platform.md)) and all of them were written after that. No environment holds data that must survive.
- On 2026-10-17 the owner said the existing code is throwaway and may be changed freely. So the ADAPT tasks need no data migrations, no role mapping of real people and no audit entries for deleted rows.
- No screen, edge route or fixture calls a hospital endpoint. Only the generated client in `packages/api-client` knows them, so each task changes the API, the generated client and the API tests.

The modules depend on each other in this order: `routing` stands alone, `case_creation` uses `availability.covering`, `accessions`, `folders` and `folder_access`, `cases` uses `folder_access`, `folder_access` uses `emergency_grants` and the matrix, and `signing` uses the roles. Two constraints tie the schema to the old roles: `memberships.all_folders` may only be true for `lead` (migration `0017`), and `memberships.role` and `invitations.role` check the five hospital roles (migrations `0005` and `0008`).

## Inventory

Kept means it stays as it is. Reworked means it stays in a changed shape. Reverted means it is deleted. The last column names the task that does it.

### Endpoints

| Operation | Path | Mark | Task |
|---|---|---|---|
| `getCase` | `GET /api/cases/{case_id}` | Reworked: no hospital fields, a case in a project | ADAPT-004 |
| `listCases` | `GET /api/cases` | Reworked: the state filter goes in ADAPT-007, the project filter comes in ADAPT-004 | ADAPT-007, ADAPT-004 |
| `createCase` | `POST /api/cases` | Reworked: a project, an ID and an optional specimen | ADAPT-006, ADAPT-009, ADAPT-005 |
| `requestEmergencyAccess` | `POST /api/cases/{case_id}/emergency-access` | Reworked: opens a clinical project, not a case | ADAPT-010 |
| `listFolders`, `createFolder`, `updateFolder`, `setFolderPeople` | `/api/tenant/folders...` | Reverted | ADAPT-002 |
| `fileCase` | `PUT /api/cases/{case_id}/folder` | Reverted | ADAPT-002 |
| `setAllFolders` | `PUT /api/tenant/members/{user_id}/all-folders` | Reverted | ADAPT-002 |
| `cancelCase`, `restoreCase` | `POST /api/cases/{case_id}/cancel`, `/restore` | Reverted | ADAPT-007 |
| `getAccessionFormat`, `updateAccessionFormat` | `/api/tenant/accession-format` | Reverted | ADAPT-006 |
| `getSigningRights`, `changeSigningRights` | `/api/tenant/members/{user_id}/signing` | Reverted | ADAPT-003 |
| `putSignature`, `deleteSignature` | `/api/me/signature` | Reverted | ADAPT-003 |
| `getMyAvailability`, `setMyAvailability`, `listAvailability` | `/api/me/availability`, `/api/tenant/availability` | Reworked: away until a time with a note, no back-up | ADAPT-009 |
| `changeMemberRole`, `listTenantMembers`, `createInvitation`, `listInvitations`, `addMember`, `invitePlatformMember` | members and invitations | Kept, with the new role values | IAM-022 |
| `updateSessionPolicy` | `PUT /api/tenant/session-policy` | Kept, guarded by the renamed settings permission | IAM-022 |

### Tables and columns

| Table or column | Migration | Mark | Task |
|---|---|---|---|
| `memberships.role`, `invitations.role` and their checks | `0005`, `0008` | Reworked: researcher, reviewer and admin | IAM-022 |
| `memberships.signs_alone`, `memberships.supervisor_user_id` | `0010` | Reverted | ADAPT-003 |
| `users.signature`, `users.signature_added_at` | `0010` | Reverted | ADAPT-003 |
| `patients` with its encrypted fields and blind indexes | `0011`, `0012` | Kept for clinical projects only | ADAPT-011 |
| `cases.id`, `tenant_id`, `created_by_user_id`, timestamps | `0012` | Kept | |
| `cases.patient_id` | `0012` | Reworked: optional, only in a clinical project | ADAPT-004, ADAPT-011 |
| `cases.accession` | `0012` | Reworked: a free-text case ID, unique per workspace after ADAPT-006 and per project after ADAPT-004 | ADAPT-006, ADAPT-004 |
| `cases.priority`, `due_at`, `assignee_user_id`, `clinical_note`, `clinical_question`, `requester` | `0012`, `0015` | Reverted | ADAPT-004 |
| `cases.source` | `0012` | Reworked: `manual` and `upload`, no `lis` | ADAPT-004 |
| `cases.state` and its check | `0012` | Reverted | ADAPT-007 |
| `cases.state_changed_at`, `cancelled_from`, `cancelled_at` | `0014` | Reverted | ADAPT-007 |
| `cases.service`, `cases.is_draft` | `0015` | Reverted | ADAPT-005 |
| `cases.folder_id` | `0016` | Reverted | ADAPT-002 |
| `specimens`, `blocks` (with `stains` and `levels`) | `0012`, `0015` | Kept, optional | ADAPT-004 |
| `slides` | `0012` | Reworked: belongs to a project, and the case becomes optional | ADAPT-004 |
| `case_requests` (idempotency) | `0015` | Kept | ADAPT-005 |
| `accession_formats`, `accession_counters` | `0013` | Reverted | ADAPT-006 |
| `folders`, `folder_members` | `0016` | Reverted | ADAPT-002 |
| `memberships.all_folders` | `0017` | Reverted | ADAPT-002 |
| `emergency_grants` | `0018` | Reworked: per project instead of per case | ADAPT-010 |
| `session_policies.emergency_hours` | `0018` | Kept | ADAPT-010 |
| `memberships.availability`, `available_again_at` | `0019` | Reworked: available or away until a time, plus a note | ADAPT-009 |
| `memberships.backup_user_id` | `0019` | Reverted | ADAPT-009 |

### Permissions and grants

| Permission | Mark | Task |
|---|---|---|
| `see-cases` | Reworked into seeing a project's slides | IAM-022 |
| `open-outside-folders` | Reworked into emergency access to a clinical project | ADAPT-002, ADAPT-010 |
| `edit-cases` | Reworked into creating cases in a project | IAM-022 |
| `upload-slides`, `move-slides` | Kept (CASES-017, moving a slide between cases, is still planned) | IAM-022 |
| `annotate` | Reworked into verdicts and edits in a person's own tasks | IAM-022 |
| `set-own-status`, `manage-people`, `integrations`, `audit-log`, `developer-mode` | Kept | IAM-022 |
| `see-team` | Reworked into seeing the workspace's people | IAM-022 |
| `lab-setup` | Reworked into workspace settings | IAM-022 |
| `cancel-cases` | Reverted | ADAPT-001 |
| `take-cases`, `reassign-cases`, `order-lab-work`, `draft-reports`, `sign-out`, `co-sign`, `amend-reports`, `ask-second-opinion`, `give-second-opinion`, `share-reports`, `tumor-boards`, `approve-models` | Reverted. Sign-off (ADJ-004), reassigning in a task (TASK-007) and models (JOBS-005) get new permissions in their own tasks | ADAPT-001 |

| Grant | Mark | Task |
|---|---|---|
| Yes, view only, no | Kept | |
| In their folders | Reverted, becomes Yes | ADAPT-002 |
| Emergency, with reason | Kept for clinical projects | ADAPT-010 |
| Assigned to them | Reworked into "in their tasks" | IAM-022 |
| Needs co-sign, as named supervisor, shared with them, measure and comment | Reverted | ADAPT-001 |

### Other code

| Code | Mark | Task |
|---|---|---|
| `routing.py` and `test_routing.py` | Reverted, nothing calls it | ADAPT-008 |
| `availability.covering` used by case creation | Reverted | ADAPT-009 |
| `case_states.py` with its 14 events | Reverted | ADAPT-007 |
| `accessions.py` | Reverted | ADAPT-006 |
| `folders.py`, `folder_access.FolderAccess`, `require_folder`, `permissions.FOLDER_SCOPED`, `grant_in_folder` | Reverted | ADAPT-002 |
| `folder_access.require_case_access` and the emergency check | Kept until ADAPT-010 moves them to projects | ADAPT-010 |
| `signing.py` | Reverted | ADAPT-003 |
| `case_creation.RULES` and `CaseDefaults` | Reverted | ADAPT-005 |
| The outside consultant role, `GuestPrincipal`, `GuestGrant`, `ActorKind.GUEST`, the case and view settings in `DatabaseScope`, and the `guest_case_scope` and `guest_hidden` policies (`enable_guest_case_scope`, `hide_from_guests`) | Reverted. Guest links (IAM-010) are an idea, and nothing creates a guest principal | ADAPT-001 |
| The six hospital roles and `ROLE_NAMES` | Reworked into researcher, reviewer and admin | IAM-022 |
| Service account scopes `see-cases`, `edit-cases`, `upload-slides`, `see-team` | Reworked to the new permission keys | IAM-022 |
| Audit actions for reverted features (`case.filed`, `folder.changed`, `case.state-changed`, `member.signing-changed`, the signature, accession and report actions) | Reverted from the enum. Old rows keep their action strings, because `audit_events.action` is text | each revert |

STACK-040 (FHIR) added no code and needs no change.

## Options considered

### Order

1. The backlog's order: roles first, then folders after project roles (PROJ-003), and the case reverts after the case rework. Folders stay until projects can scope access, but every early step has to carry code that a later step deletes. ADAPT-001 would rewrite the folder and signing logic for the new roles only for ADAPT-002 and ADAPT-003 to delete it, and PROJ-001 and ADAPT-004 would each need the other first.
2. Pure reverts first, then the roles, then cases move into projects. Each revert shrinks what the next step has to touch. While folders are gone and projects are not built yet, every member sees every case their role allows in the workspace. That is safe because there is no real data.

### Migrations

1. New forward migrations that drop what an old one added. This is safe for any database that already ran the old migrations, but the chain then holds the hospital schema twice, and every revert also needs a down migration that rebuilds it.
2. Edit the migrations in place. Each revert deletes the columns and tables from the migration that added them, deletes a migration file that becomes empty and relinks `down_revision`. This only works because no shared database ran them, and every local database has to be recreated.

## Decision

Order 2 and migrations 2. The owner's go-ahead on 2026-10-17 removes the reason for option 1 in both cases.

| Step | Task | Depends on | What it leaves behind |
|---|---|---|---|
| 1 | ADAPT-008 (revert case routing rules) | ADAPT-000 | No routing module |
| 2 | ADAPT-009 (rework availability) | ADAPT-000 | Available or away until a time with a note. Case creation no longer reroutes |
| 3 | ADAPT-003 (revert signing rights) | ADAPT-000 | No signing columns or endpoints, migration `0010` deleted |
| 4 | ADAPT-007 (revert the case state machine) | ADAPT-000 | No case state, cancel or restore. Migration `0014` deleted |
| 5 | ADAPT-006 (revert accession numbers) | ADAPT-000 | Case creation takes a typed case ID, unique per workspace. Migration `0013` deleted |
| 6 | ADAPT-002 (revert folders) | ADAPT-000 | No folders, and the grant "in their folders" becomes Yes. Migrations `0016` and `0017` deleted. The emergency path still opens a case for administrators |
| 7 | ADAPT-001 (remove hospital-only permissions, grants and the guest scope) | ADAPT-002, ADAPT-003, ADAPT-007 | The 13 hospital-only permissions, four grants, the outside consultant and every guest path gone. The five membership roles remain |
| 8 | IAM-022 (researcher, reviewer and admin roles with project roles) | ADAPT-001 | Three workspace roles, the project role names, renamed permissions and service account scopes, and an ADR that supersedes ADR 0026 |
| 9 | PROJ-000 (research check for projects) | ADAPT-000 | An ADR for the project model. It can run beside steps 1 to 8 |
| 10 | ADAPT-004 (rework cases for projects) | PROJ-000, ADAPT-006, ADAPT-007, ADAPT-002 | A minimal `projects` table with its privacy mode, cases and slides in a project, the hospital case columns gone |
| 11 | ADAPT-005 (rework case creation) | ADAPT-004 | Creation takes a project, an ID and an optional specimen. No drafts, service or rule hooks |
| 12 | ADAPT-011 (patients only in clinical projects) | ADAPT-004, PROJ-002 | Patient data refused in de-identified projects |
| 13 | ADAPT-010 (rework emergency access for clinical projects) | ADAPT-001, PROJ-002, PROJ-003 | Emergency grants per clinical project |

Every step regenerates the OpenAPI client (`pnpm api:generate`), the permission doc (`pnpm permissions:doc`) and the data map (`pnpm data-map:doc`), updates `SEEDERS` and `GET_ROUTES` in the isolation suite, and runs `pnpm check`, `pnpm typecheck`, `uv run pytest` and `pnpm test:db`. A revert supersedes the ADR it undoes: ADR 0032 (signing rights) in ADAPT-003, 0037 (accession numbers) in ADAPT-006, 0038 (case state machine) in ADAPT-007, 0046 (folders) in ADAPT-002 and 0051 (availability) in ADAPT-009. IAM-022 supersedes ADR 0026 (roles), ADAPT-004 updates ADR 0036 (case model) and ADAPT-010 updates ADR 0047 (emergency access). The ticked tasks that built the code stay ticked.

PROJ-001 (project model and API) now builds on the minimal `projects` table from ADAPT-004 and adds the API and the remaining fields. ADAPT-004 therefore creates that table with the columns PROJ-000 names, so the two tasks no longer wait on each other.

## Consequences

- Once ADAPT-002 lands and until PROJ-003 (project roles), every member sees every case their role allows. This is accepted because no shared environment holds data.
- After any step that edits an old migration, a local database at an older head has to be recreated with `docker compose down -v`, `pnpm db:up` and `pnpm db:migrate`. CI always starts empty. [knowledge/database.md](../knowledge/database.md) says so.
- Removed migration numbers are not reused. The next new migration takes the number after the highest file left.
- ADAPT-001 no longer maps roles. That moved to IAM-022, which replaces the roles outright, because there are no real memberships to migrate. ADAPT-001's old "outside consultants are removed with an audit entry" needed no work anyway, because the role check never let an outside consultant hold a membership.
- ADAPT-003 deletes the signature images with the columns and writes no audit entry for them.
- ADAPT-004 creates no default project for existing cases. Existing rows are dropped with the columns.
- The backlog edits are in the same change: ADAPT-001 to ADAPT-011, IAM-022 and PROJ-001 have new "Depends on" lines and the text above.
