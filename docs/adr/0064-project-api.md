# 0064. The project API: numbered per workspace, membership to read, owners to change, archive instead of delete

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: PROJ-001 (project model and API), touches PROJ-003 (project roles), PROJ-004 (class taxonomy), PROJ-005 (analysis templates), PROJ-008 (project settings) and ADMIN-004 (admin projects page)

## Context

[ADR 0062](0062-project-model.md) set the project model and [ADR 0063](0063-cases-and-slides-in-projects.md) created the tables. PROJ-001 adds the fields and the API: a short ID such as P07, a name, a colour, a privacy mode, an analysis template, a class taxonomy, members with project roles and a status. Several choices shape the contract that the web app and PROJ-003 build on.

## Options considered

### Project numbers

1. A counter table per workspace. Gaps never happen, but it is one more tenant-owned table to isolate and seed.
2. `max(number) + 1` under a transaction advisory lock per workspace, as case requests already lock per person. Archived projects keep their number, so numbers are never reused.

### Ending a project

1. Delete it softly with `deleted_at`. Nothing in the product asks to remove a project, and its reviews and evaluations must stay readable.
2. Archive it with `archived_at`. An archived project is read-only, it leaves the default list, and an owner can restore it.

### Who changes a project

1. Any researcher in the workspace. Simple, but it ignores the project roles.
2. Only an owner of the project. Every change needs the workspace permission `create-cases` and the owner role.

## Decision

Option 2 in each case.

| Operation | Path | Rule |
|---|---|---|
| `createProject` | `POST /api/projects` | `create-cases`. Takes a name, a colour from 0 to 11, a privacy mode and a template (`none`, `sentinel-node` or `cell-review`). The creator becomes the only owner |
| `listProjects` | `GET /api/projects?archived=` | `see-slides`. A member lists only the projects they are in, active ones unless `archived=true` |
| `getProject` | `GET /api/projects/{id}` | `see-slides` and a project role, otherwise 404. Returns `code` (P07), `my_role` and the members |
| `updateProject` | `PATCH /api/projects/{id}` | Owner only. Name, colour and template. The privacy mode changes in PROJ-002 only |
| `archiveProject`, `restoreProject` | `POST /api/projects/{id}/archive`, `/restore` | Owner only, and repeating one changes nothing |
| `setProjectMember` | `PUT /api/projects/{id}/members/{user_id}` | Owner only. The person must be a workspace member, a workspace reviewer cannot be owner, and the last owner cannot step down |
| `removeProjectMember` | `DELETE /api/projects/{id}/members/{user_id}` | Owner only, and the last owner cannot leave |

An archived project refuses changes, new members and new cases with 409 `project-archived`. Every change is audited as `project.created`, `project.changed` (with the changed field names), `project.archived`, `project.restored`, `project.member-set` or `project.member-removed`. Member changes name the person by pseudonym and carry the project ID and the roles. A service account is never a project member, so it reads every project of its workspace through its scopes and changes none.

## Consequences

- The class taxonomy is not a column. PROJ-004 adds it as its own table with keys 1 to 9 and stored mappings.
- The template only labels the project for now. PROJ-005 makes it switch the staging tools on.
- Creating cases does not yet check the project role. PROJ-003 (project roles) applies the role to every case and slide route and runs the permission test for every project role.
- TODO: PROJ-003 must decide what happens when an admin changes a project owner's workspace role to reviewer, because a workspace reviewer cannot own a project.
- ADMIN-004 (admin projects page) needs its own listing, because an admin holds no `see-slides`.
