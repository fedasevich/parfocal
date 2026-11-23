# 0434. Role test accounts are created by script

- Date: 2026-11-23
- Status: Accepted
- Deciders: Claude (lead), for Yurii Fedas to confirm
- Backlog: TEST-059 (every role has a seeded sign-in test account on open work). Changes one rule of [ADR 0397](0397-agents-sign-in-to-the-dev-app-as-a-seeded-test-account-by-script.md) (agents sign in to the dev app as a seeded test account by script). Builds on [ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month) and [ADR 0390](0390-app-parfocal-eu-is-a-development-environment.md) (app.parfocal.eu is a development environment).

## Context

On 2026-11-23 the owner asked for a walkthrough of the whole app in which they switch between roles and accounts. Only the owner, `agent-walk` and `smoke-walk` could sign in to `app.parfocal.eu`. The seeded people Rhea, Remy, Ada and Rui have no sign-in, so the reviewer, adjudicator, viewer and annotate expert paths could not be tried. ADR 0397 says the owner creates the agent test account in Zitadel by hand and no agent creates a Zitadel user.

## Decision

Six role test accounts sign in to the dev app: `role-researcher`, `role-reviewer-a`, `role-reviewer-b`, `role-adjudicator`, `role-viewer` and `role-annotator`, all `@parfocal.eu`.

- `scripts/zitadel_role_accounts.py` creates a missing Zitadel user and never changes or deletes an existing one. Creating a user is an additive production write under ADR 0151, so an agent may run it.
- The passwords live only in `~/.config/parfocal/role-accounts.env` with mode 600, never in the repo, a log, an artifact or a commit.
- The repository variable `SEED_ROLE_EMAILS` carries the role and address pairs to the reset, the same way `SEED_AGENT_EMAILS` carries `agent-walk`. The seed seats each account in the three ČVUT workspaces on open work of its role.
- `scripts/agent_session.py --role R` signs one role in and saves its own session file.

`agent-walk` stays as ADR 0397 made it.

## Consequences

- The walkthrough of PILOT-011 (a numbered walkthrough page of the whole deployed app, per role) can name an account for each step, and agents can check each role's screens.
- When the owner writes that the deployed app is production, OPS-014 (prepare production for the first real user) also deletes these six Zitadel users and the `SEED_ROLE_EMAILS` variable. Deleting them is asked of the owner, as every delete is.
- The live Zitadel password policy requires a symbol, which the tofu module does not set. The script generates passwords that meet the live policy. TODO: bring the policy into tofu so the two agree.
