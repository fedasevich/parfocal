# 0046. Folder-scoped permissions apply inside a person's folders, unfiled cases stay open, and leads may work in every folder

- Date: 2026-10-14
- Status: Superseded by 0059
- Deciders: Yurii Fedas
- Backlog: IAM-016, IAM-017, CASES-003, WL-001, TEAM-006

## Context

IAM-016 (roles narrowed by folders) says a membership carries the folders a person works in, the ten folder-scoped permissions of the matrix apply only inside them, leads may be given every folder and outside consultants never have folders. The matrix and its grades are in [ADR 0026](0026-roles-and-permission-matrix.md), and folders with their people exist since CASES-003 (folders by service). Two questions were open: what happens to cases not yet filed in any folder, and where the check runs.

## Options considered

1. Unfiled cases. Hiding them from everyone without every folder would leave new cases invisible until the lab files them, which is when consultants most need to see them coming. Treating them as outside every folder is stricter but blocks the pool. Showing them to anyone who holds the permission matches how a pool works.
2. Where the check runs. A row-level security policy would be the strongest floor, but it needs the person's folders in the database scope of every request, and guests and service accounts follow other rules. A check in the API, in one module that every case route calls, is simpler and testable now, and row-level security still keeps workspaces apart.
3. What a refusal looks like. A 404 hides that the case exists. A 403 with the code `outside-folders` lets the screen offer emergency access, which IAM-017 (emergency access with a reason) adds.

## Decision

- `parfocal_api.folder_access` reads a person's folders and their "every folder" flag. Opening a case outside them answers 403 `outside-folders`. Lists filter them out. Creating a case in, or filing a case into or out of, a folder outside them is refused the same way.
- Unfiled cases are visible to everyone who holds the permission.
- `memberships.all_folders` gives a lead every folder, set through `PUT /api/tenant/members/{id}/all-folders` ("manage people"). A check constraint keeps it for leads only.
- `grant_in_folder` turns every folder-scoped grade into "no" outside the folders, for every role except the outside consultant, whose access comes from the guest grant. Service accounts and guests are not narrowed by folders.
- `GET /api/cases` (`listCases`) lists the cases a person may see, which WL-001 (worklist) will extend.

## Consequences

- A lead without the flag sees only their own folders, so new leads need the flag set or folders chosen.
- The check is in the API, not the database. TODO: move it into a restrictive row-level security policy if case routes multiply beyond what one module can guard.
- IAM-017 builds emergency access on the `outside-folders` refusal.
