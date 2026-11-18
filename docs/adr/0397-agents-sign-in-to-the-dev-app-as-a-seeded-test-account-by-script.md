# 0397. Agents sign in to the dev app as a seeded test account by script

- Date: 2026-11-18
- Status: Accepted
- Deciders: Yurii Fedas (asked for it in his answer to decision 147), Claude
- Backlog: OPS-035 (agents get a signed-in session on the dev app). Builds on [ADR 0390](0390-app-parfocal-eu-is-a-development-environment.md) (app.parfocal.eu is a development environment) and [ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month).

## Context

On 2026-11-18 the owner answered decision 147 (how an agent checks the viewer typing tool) with option B, the post-deploy browser smoke types one outline. He also asked for a way for local agents to use a seeded account on `app.parfocal.eu`, because the deployed app is dev and is reseeded, and the agents' own rules stop them from typing a password into a sign-in page.

What the code allows today:

- The app's session is the cookie `__Host-parfocal_session`. `open_session` and `finish_login` in `apps/api` make one only after Zitadel has checked a person, either through the OIDC code flow or through `POST /api/auth/sign-in`, which checks an email and password with the Zitadel login service user (decision 95, the login service user for the app's own sign-in).
- A bearer token is accepted only with the app's own API token prefix, as a `ServicePrincipal`. `getSession` and `getMe` refuse it, and the screens need a person.
- The Worker asks for Turnstile only on `/api/auth/login`, so `/api/auth/sign-in` takes a plain HTTP client.

## Options

1. A Zitadel service user or personal access token. A machine user is not a person in our `users` table, so it gets no app session and no workspace seat. The only Zitadel credential that can start a session for a person is the login client key, which can start one for any user, real people included.
2. A new API endpoint that mints a session for a test account when it gets a shared secret. It is new attack surface on the deployed API, and a leaked secret signs in as anyone the endpoint allows.
3. A GitHub workflow that signs in with the smoke account's secret and hands the cookie back. A cookie in a run artifact or log is readable by anyone with repository read access, and the round trip takes minutes.
4. A dedicated test account with a password, kept in a file outside git with mode 600, and a small script that posts it to the existing `/api/auth/sign-in`, checks the result and saves a Playwright storage state. Nothing new is deployed, and the credential is bound to one account.

## Decision

Option 4.

- `scripts/agent_session.py` reads `~/.config/parfocal/agent-account.env` (`PARFOCAL_AGENT_EMAIL`, `PARFOCAL_AGENT_PASSWORD`). It never prints the password or the cookie.
- It refuses:
  - when the target host is not declared `development` in `infra/app-environments.json`
  - when a host other than this machine is reached without https
  - when the email is not listed in that file's `test_accounts`
  - when the credential file can be read by others or lies inside the repository
  - when the output path lies inside the repository
- After sign-in it reads `/api/me`. If the account holds no workspace, or any workspace outside `seeded_workspaces` (the three ČVUT workspaces of the showcase seed), it signs out and refuses. A test keeps that list equal to the seed's workspaces.
- It writes the session as a Playwright storage state to `~/.config/parfocal/agent-session.json` with mode 600. An agent loads it with `storageState` in Playwright, or sends the cookie from a fetch client.
- The seed takes `SEED_AGENT_EMAILS`, next to `SEED_VIEWER_EMAILS`. Each listed address gets a researcher seat with admin rights in every seeded workspace and the owner seat on every seeded project, and nothing else. A reset gives it back.
- The account is `agent-walk@parfocal.eu`. The owner creates it once in Zitadel and writes the file (decision 153, the one-time owner step for the agent test account). No agent creates the Zitadel user or the password.
- When the owner writes that the deployed app is production (the sentence that ends ADR 0390), OPS-014 (prepare production for the first real user) sets `app.parfocal.eu` to `production` in `infra/app-environments.json`, removes `SEED_AGENT_EMAILS` and deletes the Zitadel user. The script then refuses before it sends anything.

## Consequences

- Agents check the deployed app as a signed-in person without a browser sign-in page and without seeing a password. The destructive-action guard does not inspect the script, and a test proves it lets the command through.
- The account's reach is the seeded ČVUT workspaces, and the script checks this on every run. A real user's workspace makes the run sign out and fail.
- The password sits in plain text in one local file, the same as `.env`. Rotating it means changing it in Zitadel and in the file.
- The post-deploy smoke keeps its own account and secret. The agent account is separate, so revoking one does not break the other.
- The script is tested end to end against a local HTTP server. Its first run against `app.parfocal.eu` waits for the owner's step. If Cloudflare's bot rules ever block a non-browser client on `/api/auth/sign-in`, that run shows it.
