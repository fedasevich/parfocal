# Result: a SCIM user's SAML sign-in, a borrowed SCIM token and deactivation on the local Zitadel

- Date: 2026-11-17
- Backlog: IAM-030 (a SCIM-created person signs in through SAML without a duplicate)
- Kind: spike
- Commit: e6d2ad2e plus the IAM-030 change to `saml_settings`
- Environment: MacBook (arm64), macOS 15.8.1, Docker 29.9.3, local Zitadel v4.20.3 from `infra/local/zitadel.compose.yaml` under its own compose project, hosted login version 1, `kristophjunge/test-saml-idp:1.15` emulated as linux/amd64
- Data: the test IdP's built-in users `user1` and `user2` at `example.com`, a password account made by the test, no PHI

## Question

Does a person created over SCIM sign in through the workspace's SAML IdP as the same Zitadel user, can one workspace's SCIM token reach another workspace, and how fast does deactivation end sign-in.

## Method

`PARFOCAL_SAML_IDP_PORT=8191 uv run pytest tests/test_scim_sign_in.py -m db` in `apps/api` against the local Zitadel. The test provisions a workspace, runs `connect-saml` and `connect-scim`, creates `user1@example.com` over SCIM, and drives the authorize request, the IdP's login form and the SAML response with a scripted browser, then exchanges the code for tokens. The duplicate row was measured once with `isLinkingAllowed: false` and no auto-linking, the rest with linking by email.

## Results

| Check | Linking off | Linking by email |
| --- | --- | --- |
| Token subject after the SCIM user's first SAML sign-in | a new user id | the SCIM user's id |
| Users with that email in the workspace organisation | not counted | 1 |
| Resource owner and groups metadata in the ID token | not checked | the workspace organisation and `group1` |
| Confirmation page shown before linking | not applicable | none |
| Password account with the same email in the Parfocal organisation | not tried | not linked, a new user is created in the workspace organisation |

| Check after deactivation over SCIM | Observed |
| --- | --- |
| Refresh with the latest refresh token | 400, `Errors.User.NotActive` |
| Zitadel userinfo with the latest access token | 401 |
| New SAML sign-in | no code, page says "User is not active (EVENT-FJ262)" |
| `accessTokenLifetime` of the local instance | 43200 s |
| `refreshTokenIdleExpiration` of the local instance | 2592000 s |

| SCIM request with workspace A's token | Status |
| --- | --- |
| `GET` workspace A `/Users` | 200 |
| `GET` workspace B `/Users` | 404, `membership not found` |
| `POST` workspace B `/Users` | 404, `membership not found`, no user created |

| Profile field of the SCIM user after the first SAML sign-in | Value |
| --- | --- |
| Given name (SCIM sent "Ada") | `user1` |
| Family name (SCIM sent "Lovelace") | `-` |
| Email verified | true |

The SAML test took about 10 seconds with the IdP image already pulled.

## Interpretation

Linking by email removes the duplicate, and Zitadel limits it to the organisation the request is scoped to. Deactivation is immediate at Zitadel, but our API keeps an open session until the stored access token nears expiry, so a deactivated person keeps working for up to the access token lifetime. The Action replaces SCIM names with whatever the SAML assertion carries, so customers should map given and family name attributes.

## Follow-ups

- `docs/adr/XXXX-saml-sign-in-links-a-scim-user-by-email-in-its-organisation.md` records the decision.
- `TODO`: read `accessTokenLifetime` from the production OIDC settings.
- `TODO`: check the linking options on Zitadel Cloud before a customer uses SCIM and SAML together.
