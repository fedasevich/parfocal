# 0384. SCIM provisioning through the workspace's Zitadel organisation

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-013 (SCIM provisioning). Follows [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) (per-workspace SAML sign-in through Zitadel).

## Context

IAM-013 asks that a customer's directory, such as Entra ID or Okta, can create, update and deactivate the people of a workspace over SCIM 2.0. [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) gives every connected workspace its own Zitadel organisation `parfocal-<slug>` with the customer's SAML IdP, and [ADR 0025](0025-zitadel-bff-login.md) (Zitadel behind the backend-for-frontend) keeps memberships and roles in our database.

The pinned Zitadel v4.20.3 ships a SCIM 2.0 server at `/scim/v2/{organisationId}`. A run on the local Zitadel on 2026-11-17 confirmed it without a feature flag: `ServiceProviderConfig`, `POST /Users`, `PATCH` with `PatchOp` and `GET /Users/{id}` answer, and a user created there lives in the organisation the path names. The binary carries the core User schema and Zitadel's own extension attributes, but no Group schema.

## Options considered

1. Zitadel's SCIM server, reached with a personal access token of a machine user that manages users in the workspace's organisation. Nothing new to run or secure in our API, and deactivation in Zitadel stops sign-in at the source.
2. Our own SCIM 2.0 Users endpoint in the API with a per-workspace bearer token sealed by the workspace key. It could write memberships and roles straight into our database and end sessions at once, but it needs a new table, a token store, a SCIM filter and patch parser, a migration and a way to tie a provisioned person to the subject Zitadel issues on their first sign-in.

## Decision

Option 1.

- `python -m parfocal_api.tenant_command connect-scim TENANT_ID [--token-days N]` runs with the admin token, never from the running API. In the workspace's Zitadel organisation it finds or creates the machine user `scim-<slug>` with bearer access tokens, makes it an organisation member with only `ORG_USER_MANAGER`, and issues a personal access token. It prints the SCIM endpoint `<issuer>/scim/v2/<organisationId>`, the machine user id, the expiry and the token, once. The token lasts 365 days by default and at most 730.
- Running the command again keeps the machine user and its role and issues another token, so a rotation is one run followed by the customer pasting the new token. Earlier tokens stay valid until they expire or are removed in the Zitadel console.
- Our database stores nothing new, so there is no migration. Deprovisioning the workspace deletes the organisation, which should remove the machine user, its tokens and every provisioned user with it (not exercised).
- Roles still come from the SAML groups at sign-in, as [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) describes, because Zitadel's SCIM server has no groups.

## Consequences

- `apps/api/tests/test_tenant_command.py` checks against a fake Zitadel that the command keeps one machine user per organisation and issues a fresh token on each run. Against the local Zitadel it provisions a workspace, runs `connect-scim` twice, and has a SCIM client create a user, change the family name and deactivate the user with `active: false`. It then reads the user through Zitadel's own user API and finds `USER_STATE_INACTIVE`, the new family name and the workspace's organisation as resource owner, and a request without the token gets 401. It passed on 2026-11-17. CI's database job has no Zitadel, so there this test skips, and a second database test drives `connect_scim` against the fake Zitadel with the missing organisation, unknown tenant and token lifetime limits.
- A token from one workspace was not tried against another workspace's `/scim/v2/<organisationId>`. The machine user's role is granted only in its own organisation, so Zitadel should refuse it, but a second run on the local Zitadel has to confirm that.
- A deactivated person should not be able to start a new sign-in, and a session already open should end at its next token refresh, because `refresh_session` deletes the session when Zitadel refuses the refresh. Neither was exercised. Until then it lasts up to the access token lifetime of the instance (`TODO`: read it from the production OIDC settings). The membership row stays in our database, so the workspace's member list still shows the person until an admin removes them.
- `TODO`: a user created over SCIM and the same person's first SAML sign-in may collide. [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) turns auto-creation on and linking off, and user names are unique per organisation, so Zitadel may refuse to auto-create the SAML user with the SCIM user's name. Turning on linking by email for the workspace's IdP is the likely fix, but it was not tried here, and it needs the SAML spec in `apps/e2e/tests/sso.spec.ts` with a SCIM-created user before the first customer uses both.
- `TODO`: confirm that Zitadel Cloud serves `/scim/v2` to the production organisations before handing a token to a customer.
- If a customer needs roles pushed over SCIM or an instant end to open sessions, option 2 becomes the follow-up, built as an API endpoint in front of our membership table.

## Amendment 2026-11-17: SAML sign-in, a borrowed token and deactivation were tried

IAM-030 (a SCIM-created person signs in through SAML without a duplicate) answered three of the points above on the local Zitadel, as [ADR XXXX](XXXX-saml-sign-in-links-a-scim-user-by-email-in-its-organisation.md) (SAML sign-in links a SCIM user by email inside the workspace organisation) records.

- Without linking, the first SAML sign-in of a SCIM user did not collide. Zitadel created a second user with the same email. `connect-saml` now turns on linking by email, and the person signs in as the SCIM user.
- A token from one workspace gets 404 `membership not found` at another workspace's `/scim/v2/<organisationId>`, for listing and for creating users.
- After deactivation a new sign-in and the next refresh are refused at once. An open session lasts until its access token expires, 12 hours on the local instance. The production value is still `TODO`.
