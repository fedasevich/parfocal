# 0347. Per-workspace SAML sign-in through the workspace's Zitadel organisation

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-012 (per-organisation SSO). Sets the ground for IAM-013 (SCIM provisioning).

## Context

IAM-012 asks for SAML or OIDC federation per tenant with just-in-time provisioning and role mapping. OPS-019 (the Zitadel adapter for tenant provisioning) already gives every workspace its own Zitadel organisation `parfocal-<slug>`. [ADR 0025](0025-zitadel-bff-login.md) (Zitadel behind the backend-for-frontend) keeps memberships and roles in our database and names the `urn:zitadel:iam:user:resourceowner:id` claim as the key for just-in-time provisioning. [ADR 0292](0292-staging-and-production-identity-in-separate-organisations.md) (separate identity organisations) turns on `has_project_check`, so a customer organisation needs a project grant. A spike on the local Zitadel v4.20.3 with the hosted login (version 1) and a SimpleSAMLphp test IdP answered the open questions.

## Options considered

1. Where the IdP lives. In the workspace's own Zitadel organisation, or as an instance-wide IdP. The organisation keeps one customer's IdP, users and login policy apart from everyone else's, and deprovisioning removes all of it.
2. How the browser reaches the IdP. Zitadel's hosted login with the `urn:zitadel:iam:org:id:<org>` and `urn:zitadel:iam:org:idp:id:<idp>` scopes, which skip the login page and go straight to the IdP, or the app's own sign-in page driving Zitadel's session API. Only the first was tried and it works.
3. How SAML attributes reach us. A Zitadel Action (version 1) after external sign-in that fills the profile and writes the groups to user metadata, read through the `urn:zitadel:iam:user:metadata` scope, or an Actions version 2 webhook into our API, which needs Zitadel to reach the API. Zitadel does not map SAML attributes to profile fields on its own, and without the Action auto-creation stops at a registration form.
4. Who decides the role. The IdP's groups mapped in our database, or Zitadel project roles. Our database already holds roles ([ADR 0025](0025-zitadel-bff-login.md)).

## Decision

- The workspace's Zitadel organisation holds a SAML IdP with auto-creation and auto-update on and linking off, a login policy with only that IdP (no password, no registration), a project grant for the Parfocal project and an Action `parfocalSso` on the external authentication flow. The login policy sets the check lifetimes, because a custom policy left at zero sends the browser back to the IdP in a loop.
- `python -m parfocal_api.tenant_command connect-saml TENANT_ID` sets this up from the IdP metadata file with the admin token, never from the running API. Running it again updates the IdP, the login policy and the Action in place. IAM-028 (SSO from the sign-in screen) tests this against the local Zitadel: the IdP id stays, and the organisation keeps one IdP, one Action and one trigger. It stores the connection in the new `sso_connections` table (migration 0123): organisation id, IdP id, email domains, a default role and a group to role map. A domain belongs to at most one workspace.
- `GET /api/auth/sso?domain=<email domain>&return_to=<path>` starts the usual code flow with the two routing scopes and the metadata scope. An unknown domain goes to `/sign-in?sso=none` with the return path kept.
- On the callback, if the token's resource owner is a connected organisation, the user becomes a member of that workspace with the role the groups map to. Researcher wins when groups map to both roles, the default role applies when no group matches, and no default means no membership. A later SSO sign-in with other groups changes the role (tested against the fake IdP only). A sign-in without the metadata claim, such as a plain `/api/auth/login`, leaves the membership alone. SSO never gives admin rights. `member.added` and `member.role-changed` audit events carry `"source": "sso"`.
- The email from a connected organisation counts as verified only inside the workspace's domains. The Action marks every IdP email verified, so a customer IdP could otherwise claim any address and accept another workspace's invitation.
- Deprovisioning deletes the connection row together with the organisation.

## Consequences

- The E2E test `apps/e2e/tests/sso.spec.ts` signs a user in through `kristophjunge/test-saml-idp:1.15` (amd64 only, emulated on Apple silicon) and checks the mapped role. It passed twice on 2026-11-16 on a local stack.
- Actions version 1 run only with the hosted login version 1. If production moves to login version 2, the Action has to become an Actions version 2 target. `TODO`: check which login Zitadel Cloud serves to the production organisation before the first customer connection.
- Zitadel user names are unique across the instance. A person who signed up with a password under the same email could not be auto-created in the workspace organisation. [ADR XXXX](XXXX-sso-links-an-existing-account-by-verified-email.md) (SSO links an existing account by verified email) fixes this.
- OIDC federation fits the same table and command with Zitadel's generic OIDC IdP, but it was not built or tested here.
- The web sign-in page offers "Sign in with your organisation", which sends the typed domain to `/api/auth/sso` (IAM-028).
