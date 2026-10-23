# 0061. Workspace roles are researcher, reviewer and admin, with owner, reviewer and viewer per project

- Date: 2026-10-17
- Status: Superseded by 0096
- Deciders: Yurii Fedas
- Backlog: IAM-022 (researcher, reviewer and admin roles with project roles), supersedes [ADR 0026](0026-roles-and-permission-matrix.md) for IAM-006 (roles and permission matrix)

## Context

[ADR 0026](0026-roles-and-permission-matrix.md) took the hospital kit's roles: consultant pathologist, resident, lab lead, lab staff, administrator and outside consultant. ADAPT-001 ([ADR 0060](0060-no-sign-out-permissions-or-guest-scope.md)) already removed the outside consultant and the sign-out permissions. POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) "Product and roles" names three roles. A researcher uploads slides and AI results, creates review tasks, resolves disagreements and signs off. A reviewer is a doctor who reviews AI results, fixes them and gives an opinion. An admin manages people, models, formats, storage and security. Projects carry their own roles too: owner, reviewer and viewer.

## Options considered

1. Map the five hospital roles onto the new product and keep their keys. Nothing would need renaming, but `lead` and `lab` would mean researcher, and two keys would mean reviewer.
2. Replace them with the three roles of doc 37 and rename the permissions that kept their hospital wording. There are no real memberships, because the code is throwaway ([ADR 0054](0054-hospital-code-inventory-and-revert-order.md)), so nothing needs mapping.

## Decision

Option 2. `Role` is `researcher`, `reviewer` or `admin`, and the `memberships` and `invitations` role checks allow only those (migrations `0005` and `0008` edited in place). `ProjectRole` names `owner`, `reviewer` and `viewer` for PROJ-003 (project roles), and the generated [permission page](../reference/permissions.md) describes them.

| Permission | Was | Researcher | Reviewer | Admin |
|---|---|---|---|---|
| `see-slides` | `see-cases` | Yes | In their tasks | No |
| `emergency-access` | | No | No | Emergency, with reason |
| `create-cases` | `edit-cases` | Yes | No | No |
| `upload-slides`, `move-slides` | | Yes | No | No |
| `review` | `annotate` | Yes | In their tasks | No |
| `set-own-status` | | Yes | Yes | Yes |
| `see-people` | `see-team` | Yes | View only | Yes |
| `manage-people` | | No | No | Yes |
| `workspace-settings` | `lab-setup` | View only | No | Yes |
| `integrations` | | View only | No | Yes |
| `audit-log` | | No | No | Yes |
| `developer-mode` | | Yes | No | Yes |

The grant "assigned to them" is now "in their tasks". The admin sees no patient data, and reaches a case only through emergency access. Service account scopes follow the renamed keys: `see-slides`, `create-cases`, `upload-slides` and `see-people`.

## Consequences

- Until TASK-001 (review task model) and PROJ-003 (project roles), "in their tasks" lets a reviewer through to every case in the workspace. Those tasks narrow it, and the isolation test that hides a project from a reviewer who is not in it belongs to PROJ-003.
- A draft case is seen only by its author, because no hospital role is left that saw every draft. ADAPT-005 (case creation) removes drafts.
- Only an admin changes the session policy, reads the audit log and invites people. A researcher brings in reviewers through a task invitation (TASK-006).
- The tenant isolation suite now gives each GET route the role that may call it, because no single role reads every route.
- The e2e invitation test invites a researcher.
