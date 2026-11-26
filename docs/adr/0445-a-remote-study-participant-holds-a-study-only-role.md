# 0445. A remote study participant holds a study only role that reaches only their own prepared project

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

- `Role.STUDY_PARTICIPANT` (`study-participant`) is a third column of the permission matrix. Inside a project the seat owns it grants what a researcher grants for seeing, creating cases, uploading, moving slides and reviewing, so every round 5 task still works. It runs no models, so a leaked link cannot start GPU work, and it gets no emergency access, privacy mode, people management, workspace settings, integrations, audit log or developer mode and API tokens. Outside its project it reads only the people list and the template library, view only, because the review and project screens show names and the project's template. Admin rights never add to it.
- `createProject`, `createSampleProject`, `deleteProject`, `inviteTaskReviewer`, `requestProjectAccess` and `offerStudyTemplate` pass the matrix through a permission the role holds, so `require(..., study_participants=False)` also refuses the role there. The signed in routes `createMyWorkspace`, `joinWorkspace`, `askToJoinWorkspace`, `acceptInvitation`, `startPasskeyRegistration` and `savePasskey` refuse a study seat through `not_for_study_participants()`. Both answer 403 `study-participant-refused` and mark the operation with `x-not-for-study-participants`, and a test pins the marked list.
- A principal is a study participant when its role is `study-participant` or its subject is a study placeholder seat, and `grant_of` then reads the participant column whatever the stored role says. A seat made before this change, still a researcher in `memberships`, is narrowed the same way, and preparing its code again sets the stored role to `study-participant`.
- The role is never assignable. Role changes, invitations and memberships made by people, SAML default and group roles and the tenant command accept only researcher and reviewer. Migration 0163 widens only the `memberships` role check, and invitations keep their own narrower check.
- The web hides New project in the sidebar, the top bar, the command palette, Home and My work for the role, and Admin stays hidden because the seat holds no admin rights.

## Consequences

- A leaked link opens one prepared project and the study page. What the seat does there, such as uploads, decisions and comments, stays in that project like any owner's work, but the seat cannot make a passkey, a workspace, an API token or an invitation that would let anyone back in after its session ends.
- A new permission needs a participant cell, because the matrix test needs a value for every role, and the participant sweep checks that every closed cell answers 403.
- Migration 0163 must run before the API and the study seed function run this code, or the first prepare fails the old role check.
- A new route that creates something outside a project and is guarded only by a project permission must add `study_participants=False`, or the participant may reach it.
