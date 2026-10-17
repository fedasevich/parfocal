# 0066. Emergency access opens one clinical project for a set time, for researchers and admins outside it

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-010 (emergency access for clinical projects), supersedes [ADR 0047](0047-emergency-access-with-a-reason.md) for IAM-017 (emergency access with a reason), touches NOTIF-001 (notification service) and SEC-024 (audit queries)

## Context

[ADR 0047](0047-emergency-access-with-a-reason.md) let a person open one case outside their folders after giving a reason, for a lab-set time. Folders are gone ([ADR 0059](0059-no-folders.md)), and opening a project needs a project role ([ADR 0065](0065-project-role-enforcement.md)). Patient data lives only in clinical projects ([ADR 0062](0062-project-model.md)). The emergency path has to follow the data.

## Options considered

### What a grant opens

1. One case, as before. Narrow, but in a project a case is often one of many slides of the same study, and a person looking into a problem needs the project's context.
2. One clinical project, read-only. It matches the unit that holds the patient data and the unit that roles are given on.

### Who may ask

1. Administrators only. Researchers outside a project would have to ask an owner even in an emergency.
2. Researchers and administrators. Workspace reviewers reach patients only through their tasks, so they cannot ask.

## Decision

Option 2 in both cases.

- `POST /api/projects/{id}/emergency-access` takes a reason of 10 to 500 characters and needs `emergency-access`, which researchers and admins hold as "emergency, with reason". The grant lasts the workspace's `emergency_hours` (1 to 24, default 4).
- A de-identified project answers 409 `no-emergency-access`, and the database refuses such a grant too. `emergency_grants` carries a `privacy_mode` column fixed to `clinical` with a key on the project's mode, as `patients` does. A project member answers 409 `already-in-project`.
- With a grant, the person reads the project, its cases and their patients as a viewer would. They change nothing, and changes answer 403 `project-owners-only`.
- Without a grant, a researcher or admin outside a clinical project gets 403 `emergency-access-needed` on `getProject` and `getCase`, which tells the screen to ask for a reason. For a de-identified project they get 404. `listCases` shows the projects they hold a grant for, and an admin with no grant at all gets 403 `emergency-access-needed`.
- The audit entry is `project.emergency-access` on the project, with the reason, the hours and the role.
- The grant table moved to `project_id` in migration `0018`, edited in place, and the case-level check in `case_access.py` went into `parfocal_api.project_access`.

## Consequences

- The project's owners are not notified yet, because notifications do not exist. NOTIF-001 (notification service) now lists this event.
- SEC-024 (audit queries and signed export) marks these entries by their action, as before.
- The reason is still free text classed as PHI, and the screen should ask people not to type identifiers into it.
