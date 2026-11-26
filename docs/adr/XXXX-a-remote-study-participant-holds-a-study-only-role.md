# XXXX. A remote study participant holds a study only role that reaches only their own prepared project

- Date: 2026-11-26
- Status: Accepted
- Deciders: Claude
- Backlog: EXP-023 (a remote study participant holds a study only role). Narrows [ADR 0442](0442-a-one-use-link-signs-a-study-participant-into-their-own-seat.md) (a one-use link signs a remote study participant into a seat of their own) and changes the role list of [ADR 0026](0026-roles-and-permission-matrix.md) (roles and permission matrix).

## Context

ADR 0442 seats a remote participant who opens a join link as a researcher without admin rights in the study workspace. A researcher there can create projects, ask for emergency access, make API tokens, make a workspace of their own and add a passkey that outlives the one session the link gives. Anyone holding a link inside its day gets that seat, so the seat must reach only the project prepared for it and the study page before real participants use it.

## Options considered

- Keep the researcher role and refuse study seats by their placeholder subject on every route that matters. Nothing in the matrix says what the seat may do, and every new route is open to it by default.
- A membership flag beside the role, like admin rights. A flag adds rights in the matrix, and here the need is to take them away.
- A third workspace role, `study-participant`, with its own matrix column, which a migration allows only in `memberships`.

## Decision

- `Role.STUDY_PARTICIPANT` (`study-participant`) is a third column of the permission matrix. It grants what a researcher grants inside a project the seat owns, so every round 5 task still works, and nothing at the workspace level: no emergency access, privacy mode, people management, audit log or developer mode and API tokens. It reads people, workspace settings, integrations and the template library view only, as the study pages need. Admin rights never add to it.
- `createProject`, `deleteProject` and `inviteTaskReviewer` pass the matrix through `create-cases`, so `require(..., study_participants=False)` also refuses the role there. The signed in routes `createMyWorkspace`, `joinWorkspace`, `askToJoinWorkspace`, `acceptInvitation`, `startPasskeyRegistration` and `savePasskey` refuse a study seat through `not_for_study_participants()`. Both answer 403 `study-participant-refused` and mark the operation with `x-not-for-study-participants`, and a test pins the marked list.
- A principal is a study participant when its role is `study-participant` or its subject is a study placeholder seat, so a seat made before this change is refused too. Preparing a code again sets its membership role to `study-participant`.
- The role is never assignable. Role changes, invitations and memberships made by people, SAML default and group roles and the tenant command accept only researcher and reviewer. Migration 0163 widens only the `memberships` role check, and invitations keep their own narrower check.
- The web hides New project in the sidebar, the top bar, the command palette, Home and My work for the role, and Admin stays hidden because the seat holds no admin rights.

## Consequences

- A leaked link opens one prepared project and the study page, and nothing the seat does outlives its session.
- A new workspace level permission starts closed for the participant column, because the matrix test needs a value for every role and the participant sweep checks every closed cell answers 403.
- A new route that creates something outside a project and is guarded only by a project permission must add `study_participants=False`, or the participant may reach it.
