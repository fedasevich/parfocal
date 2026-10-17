# 0059. Folders are removed, and access is by role across the workspace until project roles land

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-002 (revert folders), supersedes [ADR 0046](0046-roles-narrowed-by-folders.md) for IAM-016 (roles narrowed by folders) and CASES-003 (folders and spaces)

## Context

[ADR 0046](0046-roles-narrowed-by-folders.md) narrowed ten permissions to the folders (services) a person works in, let leads work in every folder, and left unfiled cases open. Folders came from the hospital's sections. Since [ADR 0053](0053-ai-results-review-direction.md) a project groups slides and people, and project roles (PROJ-003) decide who sees what. [ADR 0054](0054-hospital-code-inventory-and-revert-order.md) put the folder revert before the role change, so that ADAPT-001 and IAM-022 do not have to carry folder rules.

## Options considered

1. Keep folders until PROJ-003 replaces them. Access stays narrow in between, but ADAPT-001 and IAM-022 would rewrite folder rules for roles that are about to change, only for them to be deleted later.
2. Remove folders now and let every member see what their role allows across the workspace until PROJ-003. That is wider access for a while, which is acceptable only because no shared environment holds data.

## Decision

Option 2. `folders`, `folder_members`, `cases.folder_id`, `memberships.all_folders`, `parfocal_api.folders`, the six folder endpoints, `FOLDER_SCOPED`, `grant_in_folder`, the grant "in their folders" and the audit actions `folder.changed` and `case.filed` are gone. Migrations `0016` and `0017` were deleted, and `0018` now follows `0015`. Every cell that said "in their folders" now says Yes.

The emergency check moved from `folder_access` to `parfocal_api.case_access`. The permission `open-outside-folders` became `emergency-access` ("open a case their role does not reach"), and only administrators hold it, because every other role that sees cases now sees all of them. An administrator still reads a case's patient only after giving a reason.

## Consequences

- Case responses no longer carry `folder_id`, and `POST /api/cases` no longer takes it.
- The tests for emergency access now cover administrators only, and the roles that see cases are checked to need no reason.
- PROJ-003 (project roles) brings back narrow access with projects. ADAPT-010 (emergency access for clinical projects) moves the grant from a case to a project and updates [ADR 0047](0047-emergency-access-with-a-reason.md).
