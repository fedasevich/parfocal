# 0386. SAML sign-in links a SCIM user by email inside the workspace organisation

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-030 (a SCIM-created person signs in through SAML without a duplicate). Changes [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) (per-workspace SAML sign-in through Zitadel) and answers a `TODO` in [ADR 0384](0384-scim-provisioning-through-zitadel.md) (SCIM provisioning through Zitadel).

## Context

[ADR 0384](0384-scim-provisioning-through-zitadel.md) lets a customer's directory create people in the workspace's Zitadel organisation over SCIM. [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) set the workspace's SAML IdP to auto-create users with linking off. A run on the local Zitadel v4.20.3 on 2026-11-17 showed what that does to a SCIM-created person: their first SAML sign-in did not fail on a name collision, Zitadel silently created a second user with the same email, and the token carried the new user's subject. Everything the directory set on the SCIM user, including a later deactivation, would then miss the person who actually signs in.

[ADR 0352](0352-sso-links-an-existing-account-by-verified-email.md) (SSO links an existing account by verified email) refused Zitadel's linking for a different case, a password account in the Parfocal organisation, because a link across organisations breaks the resource owner check in our callback. A SCIM user lives in the workspace's own organisation, so that objection does not apply to it.

## Options considered

1. Turn on linking and auto-linking by email on the workspace's IdP, so Zitadel attaches the SAML identity to the user with that email in the organisation the request is scoped to.
2. Auto-link by user name instead. The directory decides the SCIM `userName`, and Entra ID and Okta often send an object id or a UPN there, while the Action sets the SAML user name to the email, so the two would often not match.
3. Keep linking off and merge the two Zitadel users in our database the way [ADR 0352](0352-sso-links-an-existing-account-by-verified-email.md) does. The SCIM user would stay in Zitadel unused, and deactivating it would not stop the SAML user, so the directory would lose control over sign-in.

## Decision

Option 1. `connect-saml` sets the IdP's `providerOptions` to `isLinkingAllowed: true` and `autoLinking: AUTO_LINKING_OPTION_EMAIL`, keeping auto-creation and auto-update on.

## Consequences

- `apps/api/tests/test_scim_sign_in.py` checks on the local Zitadel with the `kristophjunge/test-saml-idp:1.15` IdP, driving the hosted login (version 1) with a scripted browser and no web app. A user created over SCIM signs in through SAML and the token's subject is the SCIM user's id, twice, and the organisation holds one user with that email. With linking off the same test gets a different subject, which is the duplicate this ADR removes. Zitadel linked without showing a confirmation page.
- Auto-linking stays inside the organisation the request names. A password account with the same email in the Parfocal organisation is not linked, and the SAML sign-in still creates a new user in the workspace organisation, so [ADR 0352](0352-sso-links-an-existing-account-by-verified-email.md) keeps working as before.
- One workspace's SCIM token cannot reach another. Listing or creating users at another workspace's `/scim/v2/<organisationId>` answers 404 with `membership not found`, and no user is created there.
- Deactivation over SCIM stops a new SAML sign-in ("User is not active"), refuses the next refresh with `Errors.User.NotActive`, and makes Zitadel's userinfo answer 401 for the old access token at once. Our API asks Zitadel nothing during an open session until the stored access token is within 30 seconds of expiry, and then `refresh_session` deletes the session when the refresh is refused, so an open Parfocal session ends at the first request after that point, unless the workspace's idle or lifetime limit ends it first. The local instance issues access tokens for 43200 seconds (12 hours). `TODO`: read `accessTokenLifetime` from the production OIDC settings and decide whether 12 hours is too long for a deactivated person.
- The Action overwrites the SCIM profile on each sign-in. Without `--given-name-attribute` and `--family-name-attribute` the SCIM user "Ada Lovelace" became given name `user1` and family name `-`. Connect real customers with both attributes.
- The linked sign-in carries what our callback needs. The ID token's resource owner is the workspace organisation and the Action's groups metadata is there (`group1` for the test user), so membership and role mapping work as in [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md).
- Workspaces connected before this change keep linking off until an operator runs `connect-saml` again for them. Only a new IdP was tested. Updating an existing IdP goes through the PUT that `save_saml_idp` already uses, which was not exercised with the new options.
- `TODO`: the same options have to be checked against Zitadel Cloud, together with the login version `TODO` in [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md), before a customer uses SCIM and SAML together.
