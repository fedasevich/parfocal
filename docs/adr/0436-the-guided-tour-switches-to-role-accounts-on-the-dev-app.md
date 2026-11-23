# 0436. The guided tour switches to role accounts on the dev app through a flagged server switch

- Date: 2026-11-23
- Status: Proposed
- Deciders: Claude (agent), for Yurii Fedas to confirm
- Backlog: PILOT-013 (a guided tour runs over the real app, ringing each control, and switches between the role accounts). Builds on [ADR 0434](0434-role-test-accounts-are-created-by-script.md) (role test accounts are created by script) and [ADR 0390](0390-app-parfocal-eu-is-a-development-environment.md) (app.parfocal.eu is a development environment). OPS-014 (prepare production for the first real user) removes it.

## Context

The owner wants to click through the whole real app the way the frozen mock's Play all tour worked, with a chip that says which person they are. Some steps are done by the researcher, others by reviewer A, the adjudicator or the viewer. Signing out and in with a password between steps breaks the flow, and the role account passwords live only in the agent's private config file.

## Options

1. Sign out and sign in by hand at each change of role. No server change, but the tour stops at every role and needs the six passwords.
2. Put the role passwords behind a server call that signs in through Zitadel. The passwords would reach the API's config and every call would hit Zitadel.
3. A server switch that changes which person the current session belongs to, limited to the six role accounts and back to the account that started it, on only when a server flag is set.

## Decision

Option 3.

- `POST /api/tour/role-switch` takes one of `researcher`, `reviewer-a`, `reviewer-b`, `adjudicator`, `viewer` or `annotator`. It needs the Manage people right, which only a member with admin rights holds. The target is the user `role-NAME@parfocal.eu` with an active membership in the caller's current workspace. Any other account, or a role account of another workspace, is refused.
- The switch keeps the same session row. It changes the row's subject to the role account and keeps the starting account's subject, name and email inside the encrypted token blob that already holds the identity tokens. No password and no token reaches the client, and no migration is needed. A token refresh keeps the starting account in the blob.
- `DELETE /api/tour/role-switch` returns the session to the starting account. It is the only call a role account may make about the switch, and it can only ever return to the account that really signed in. Role to role goes back first and then forward, in one click of the tour.
- Both calls write an audit event, `user.tour-role-switched` and `user.tour-role-returned`, in the workspace.
- Both answer 404 unless the API setting `TOUR_ROLE_SWITCH` is true. It defaults to false. The deploy bootstrap writes it only when `TOUR_ROLE_SWITCH=on` is in the shell and the deploy target is marked `development`, which today is only the `production` entry that ADR 0390 calls a development environment. Asking for it on any other target stops the bootstrap.

## Consequences

- The tour menu plays every chapter with one click per change of role, and the chip shows the account the session really belongs to.
- The deployed run needs the lead to run `TOUR_ROLE_SWITCH=on uv run --package parfocal-deploy python -m parfocal_deploy.bootstrap --env production` and then redeploy the API, which writes only the config secret.
- OPS-014 sets `development=False` on that deploy target, removes the setting from the config secret and deletes the switch with the role accounts. Until then an admin of the dev app can act as any role account of their own workspace, which is the point.
