# 0065. Project roles narrow the workspace grant, only workspace members reach workspace routes, and owners stay researchers

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: PROJ-003 (project roles), touches TASK-001 (review task model), ADAPT-010 (emergency access for clinical projects) and IAM-020 (deactivation with hand-over)

## Context

[ADR 0062](0062-project-model.md) said that opening a project needs a project role and that one API helper turns the workspace grant and the project role into the effective grant, with row-level security staying per workspace. [ADR 0064](0064-project-api.md) applied that to the project routes. PROJ-003 applies it to cases and slides. On 2026-10-17 the owner also set the rule that only workspace members reach workspace routes from the API, with service accounts keeping their workspace-wide scopes.

## Options considered

### Combining the grants

1. Take the narrower grant everywhere. Simple, but a workspace reviewer, whose grant is "in their tasks", could never read a project even as its viewer, which makes the viewer role useless for doctors.
2. Take the narrower grant, except that "in their tasks" with a project grant of yes becomes view only. A workspace reviewer who is a project viewer reads the project and changes nothing.

### A project owner whose workspace role becomes reviewer

1. Turn their ownerships into viewer roles. The project could end up with no owner.
2. Refuse the role change with 409 `owns-projects` until their projects have other owners, as IAM-020 (deactivation with hand-over) does for open work.

## Decision

Option 2 in both cases.

| Permission in a project | Owner | Reviewer | Viewer |
|---|---|---|---|
| `see-slides` | Yes | In their tasks | Yes |
| `create-cases`, `upload-slides`, `move-slides` | Yes | No | No |
| `review` | Yes | In their tasks | No |

`permissions.PROJECT_MATRIX` holds the table, `permissions.in_project` combines it with the workspace grant, and `parfocal_api.project_access` reads the person's project role. A case is read only when the effective grant reads the whole project (yes or view only). Otherwise it answers 404, so a person outside a project cannot learn that a case exists. `listCases` shows only cases in projects where the person is an owner or a viewer. Creating a case needs the effective grant yes, which only an owner has. A member of the project with another role gets 403 `project-owners-only`, and anyone else gets 404. An administrator still reads a case only through emergency access.

Until TASK-001 (review task model) builds tasks, a project reviewer reads no cases at all, because "in their tasks" has no tasks to point at. TASK-001 extends `project_access.readable` and the case check with the slides of the person's tasks.

Only principals with a membership in the workspace reach workspace routes. `tenant_connection` refuses everyone else, and the role is read from `memberships` on every request, so a removed member loses access at once. Removing a membership removes the person's project roles through `ON DELETE CASCADE`. Service accounts reach every project of their workspace through their scopes.

## Consequences

- `test_project_roles.py` runs every project and case route for every pair of workspace role and project role, and computes the expected answer from the matrix. A reviewer is shown never to see another project's slides.
- `test_permissions.py` sends every workspace route as a signed-in person without a membership and expects 403.
- The permission page shows the project matrix and the combining rule.
- ADAPT-010 (emergency access for clinical projects) no longer waits for PROJ-002, because the privacy mode column it needs exists.
