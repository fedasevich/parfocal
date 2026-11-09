# 0266. The admin page has ten sections, each behind one permission

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (research check done by an agent from the code, the mock and ADR 0096)
- Backlog: ADMIN-000 (research check), ADMIN-001, ADMIN-002, ADMIN-003, ADMIN-004, ADMIN-005, ADMIN-006, ADMIN-007, ADMIN-008, ADMIN-009, ADMIN-011 (last mock controls in Admin)

## Context

[ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md) (researcher and reviewer with admin rights) says who opens the admin page and which permissions admin rights add. It does not list the page's sections. The admin shell, most sections and their API routes now exist, so this record writes down what each section holds, which permission the API checks for it and what is still to come.

## Decision

Only a researcher with admin rights opens the page. A reviewer and a researcher without the right see a refusal that says whom to ask (`admin-access.ts` in the web app). The API checks the permission on every route, so the screen is never the only guard. Admin rights add no access to project data.

| Section | What it holds | Permission checked by the API | State |
|---|---|---|---|
| Overview | Workspace at a glance: people, projects, models, space and recent audit events | The permission of each figure it reads | Built (ADMIN-002, overview) |
| People and roles | Invite people, set role and admin rights, deactivate, pending invitations. The last holder of admin rights cannot lose it | `manage-people` | Built (ADMIN-003, people and roles) |
| Projects | Active and archived projects, archive and restore, privacy mode and class list of new projects, deleted projects kept for 30 days | `workspace-settings` for the rules. Archive follows the project right | Built (ADMIN-004, projects). Privacy and class list save through workspace settings (ADMIN-010 and ADMIN-011, wiring the mock controls). The mock's who-may-create choice is hidden, because creating a project follows the `create-cases` permission and no setting changes it |
| AI models | Show or hide Parfocal models, connect, test and run the lab's own models, active runs | `workspace-settings` to show or hide. `integrations` to connect and test | Built (ADMIN-005, AI models) |
| Report templates | The template library: built-in and the lab's own, preview, duplicate, edit, use for new projects, retire | `report-templates`. Using a template needs only the researcher's view. Editing needs admin rights | List and API built. The editor is ADMIN-008 (report templates), ready |
| Storage and sources | Space by kind and by project, connected sources and their state, retention | `integrations` for space and sources. Retention and legal holds check `workspace-settings` for reading and saving, because they are data rules of the workspace and not connections | Retention saves (ADMIN-010). Space and sources wait on ADMIN-006 (storage, sources, API and webhooks) |
| API and webhooks | Service accounts, API tokens, incoming and outgoing webhooks | `integrations` | Service accounts built. Tokens and webhooks wait on ADMIN-006 and are mock buttons today |
| Audit log | Search and signed export of audit events, with member names resolved in the view only | `audit-log` | Built (ADMIN-007, audit log and security, and ADMIN-009, named actors) |
| Security | Sign-in method, two factors, session lock, security contact | `workspace-settings` | Built, with the two-factor switch wired by ADMIN-009 and the lock time by ADMIN-010. Other sign-in methods show read-only. The mock's log-slides, watermark and EU switches are hidden (ADMIN-011): every slide opened is already logged with no switch, export watermarks do not exist, and the EU region waits on SEC-005 (data residency enforcement) |
| Workspace settings | Name, join domain, announcements, site validations | `workspace-settings` | Built (ONB-011, join domain, is in progress) |

A researcher without admin rights keeps the view-only access that ADR 0096 gives for `workspace-settings`, `integrations` and `report-templates`, but reaches it through the screens that use those things, such as the model list and the template picker. They never see the admin page.

## Consequences

- The remaining ADMIN work is ADMIN-006 (tokens, webhooks, space and sources) and ADMIN-008 (the template editor). Both reuse the permissions above and add none.
- New admin sections need an existing permission or a change to the matrix in `permissions.py` and ADR 0096. The generated [permission page](../reference/permissions.md) stays the single list.
- After ADMIN-010 (class lists, retention and session lock) and ADMIN-011 (last mock controls in Admin), every switch in Projects and Security saves and reads back or is hidden until its feature exists. The tokens, webhooks and space mocks belong to ADMIN-006.
