# 0167. Task invitations ride on workspace invitations, and their email may name the project and task

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: TASK-006. Touches IAM-007, NOTIF-004 and ONB-003.

## Context

TASK-006 (invitations to a task) asks that inviting someone new to a review task sends an email that names who asked, the project, the work and the due date, and that accepting creates the account and opens the first slide. [ADR 0030](0030-invitations-bound-to-verified-email.md) (invitations bound to a verified email) already invites people into a workspace, and [ADR 0039](0039-email-through-resend-with-phi-rules.md) (email through Resend with PHI rules) lets an email name only the workspace and the recipient, from reviewed templates with typed parameters.

## Options considered

1. Where the task link lives. A separate task invitation table would need its own token, expiry and isolation seeding. One nullable `task_id` column on `invitations` reuses the token, the verified-email check, expiry and audit of ADR 0030.
2. Who may invite. Workspace invitations need `manage-people`. Requiring it here would stop project owners, who build tasks, from adding a new reviewer. Letting the project owner of an open task invite, with the role fixed to reviewer and no admin rights, keeps the reach small.
3. What the email may name. Names of the project and the task are labels researchers type. They are not patient data under the ADR 0039 rules, but a careless name could hold some. Keeping them out of the subject and only in the body limits what mail previews show.

## Decision

- `POST /api/review-tasks/{task_id}/invitations` takes an email. It needs `create-cases` and ownership of the task's project, refuses an archived project or a signed-off task, and creates a workspace invitation with role reviewer and the task id. Inviting someone who is already a member answers 409, because members are added with `addTaskReviewer`.
- The `task-invitation` template takes `inviter_name`, `project_name`, `task_name`, `slide_count`, `due_on`, `workspace_name` and `link`. The subject names only the workspace. Slide labels, case labels and comments never reach it.
- Accepting a task invitation also makes the person a project reviewer and assigns every task slide, audited as `project.member-set` and `task.reviewer-added`. The answer carries `landing` with the project, task and first slide, which the web opens. If the task closed in the meantime the person still joins the workspace and `landing` is empty.
- The email link stays `/invitations/{token}`. The web redirects it to the invite landing.

## Consequences

- A project owner can bring a new person into the workspace as a reviewer without admin rights. Admins see the invitation in the normal list, which now shows its `task_id`.
- The invite landing still reads a draft preview endpoint. ONB-003 (invite landing) replaces it with a real one.
- A task that holds only invited people cannot be created yet, because a task needs at least one reviewer. TODO: decide whether to allow it.
