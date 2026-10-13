# 0026. Six roles and the UX kit's permission matrix in code, declared on every route

- Date: 2026-10-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-006, IAM-010, IAM-014, IAM-016, IAM-017, IAM-018

## Context

IAM-006 was written during planning with nine roles: org admin, lab admin, lab lead, consultant pathologist, resident, annotator, guest consultant, secretary and read-only clinician. The UX kit's later Roles and access page (gap review, [ADR 0023](0023-gap-review-backend-first.md)) has six roles and a 26-row matrix whose cells are graded, such as "in their folders", "assigned to them", "needs co-sign" or "view only". It says the matrix is what developers enforce on the server. [ADR 0020](0020-authorization-rls-scopes-and-rbac.md) already put role permissions in code, checked by a FastAPI dependency before any query.

## Options considered

1. Keep the nine planning roles. They name people the kit no longer has (secretary, annotator, read-only clinician) and would need a matrix nobody designed.
2. Take the kit's six roles and matrix as they are. They are the current design, cover the personas, and come with the grades the features need.
3. Custom permission sets per lab. The kit rejected this, because sets become unreadable and every new screen needs a decision for each set.

For enforcement, a central table of operation to permission in the test suite only, or a permission declared on the route itself. Declaring it on the route keeps the rule next to the code and puts it in the OpenAPI schema as `x-permission`, where the test and the generated client can read it.

## Decision

Option 2, declared on each route.

- Roles are `consultant`, `resident`, `lead`, `lab`, `admin` and `outside-consultant`. A membership holds one of the first five. Outside consultants never hold a membership and get their column through a guest grant (IAM-010). Platform operators sit outside the matrix.
- `parfocal_api.permissions` holds the matrix exactly as the kit has it, row for row, with the kit's grade letters. A route declares `**require(Permission.X)`, which refuses a role whose cell is empty and returns the grade for the endpoint to narrow further.
- The grade is a ceiling, not the whole rule. "In their folders" covers the whole workspace until IAM-016 adds folders, "assigned to them", "as named supervisor" and "needs co-sign" are checked by the features that own those rows, and "emergency, with reason" waits for IAM-017.
- Every operation either declares a permission or is listed in the test with the reason it is open (public, signed-in, any member, platform). A table-driven test calls every guarded route as each of the six roles and expects 403 exactly where the matrix is empty.
- `docs/reference/permissions.md` is generated from the matrix by `pnpm permissions:doc`, and a test fails when it is stale.
- A person cannot change their own role, so a lead or administrator cannot lock everyone out by accident.

## Consequences

- The secretary, annotator and read-only clinician roles are gone. TODO: if research workspaces need people who only annotate, add a role and its column through a new ADR rather than reusing `lab`.
- Changing a cell changes behaviour and the generated page together, so a matrix change shows up in review as a diff of the page.
- Role changes are not audited yet. TODO: SEC-003 must record them.
- IAM-006 was edited to name the six roles.
