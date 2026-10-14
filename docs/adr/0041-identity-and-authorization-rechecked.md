# 0041. Identity and authorization rechecked in October 2026

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-000, STACK-023, STACK-028, IAM-001, IAM-012, IAM-010

## Context

IAM-000 asks whether [ADR 0020](0020-authorization-rls-scopes-and-rbac.md) (STACK-023, authorization) and [ADR 0025](0025-zitadel-bff-login.md) (STACK-028, identity) still hold in October 2026. Both were accepted on 2026-10-08 and 2026-10-13, so this is a check against what the market and the vendors say now, plus what the code built since has shown. Nothing was measured. All facts below come from the linked pages, read on 2026-10-14. Anything the pages did not say is marked `TODO`.

What was built since: roles and the permission matrix in code ([ADR 0026](0026-roles-and-permission-matrix.md)), the audit hash chain ([ADR 0027](0027-audit-log-hash-chain-in-postgres.md)), service accounts with our own tokens ([ADR 0029](0029-service-accounts-with-own-api-tokens.md)), invitations bound to verified email ([ADR 0030](0030-invitations-bound-to-verified-email.md)), the idle lock ([ADR 0031](0031-idle-lock-from-explicit-activity.md)) and signing rights on the membership ([ADR 0032](0032-signing-rights-on-the-membership.md)). All of them sit on the same two foundations. The database scope is set once per transaction, and the identity provider only proves who a person is. Our database holds tenants, memberships, roles and rights. The lessons are in [knowledge/auth.md](../knowledge/auth.md) and [knowledge/database.md](../knowledge/database.md).

## Options considered

### Identity (STACK-028)

| Option | What the sources say | Verdict |
|---|---|---|
| Zitadel Cloud (current) | The [pricing page](https://zitadel.com/pricing) lists Free at US$0 with 100 daily active users, unlimited users and organisations, 3 identity providers, all security features and data residency in EU, US, Switzerland and Australia. Pro is US$100 a month with 25,000 daily active users and a 1 hour response objective. Enterprise is custom. The [endpoint reference](https://zitadel.com/docs/apis/openidoauth/endpoints) lists the end session endpoint, `prompt=login`, `S256` PKCE only, `offline_access` refresh tokens that return a new refresh token on each refresh, and revocation. | Keep |
| Keycloak | The [release page](https://github.com/keycloak/keycloak/releases) shows five releases between 2026-08-31 and 2026-10-13, 26.7.3 to 26.8.1, most with security fixes (for example CVE-2026-94000 where a delegated admin can become realm admin, and CVE-2026-89298 where a confidential client secret reached the view-clients role). It is self-hosted, so we would patch it ourselves. | Reject, as before |
| Ory Network | The [pricing page](https://www.ory.com/pricing) puts EU data storage on Production (US$770 a year) and above, bills US$0.14 per average daily active user, and keeps one-click SAML SSO and SCIM on Enterprise. Developer has no production environment. | Reject, no gain over Zitadel |
| WorkOS AuthKit | The [pricing page](https://workos.com/pricing) gives the first 1M monthly active users free and SSO at US$125 per connection a month. Data regions are not stated on the page (`TODO`, ask WorkOS sales). | Reject for now, EU residency unconfirmed |
| Auth0 | The [pricing page](https://auth0.com/pricing) has a free plan to 25,000 monthly active users with 1 enterprise connection, and B2B Essentials from US$150 a month for 500 users. An EU region is not mentioned on that page (`TODO`). | Reject, residency unconfirmed and costlier at pilot scale |
| Authentik | Not re-checked. ADR 0003 and ADR 0025 did not weigh it, and it is self-hosted like Keycloak. | `TODO`, not needed |

Zitadel's current features cover what ADR 0025 relies on. The [login guide](https://zitadel.com/docs/guides/integrate/login/oidc/login-users) recommends PKCE and registers `post_logout_redirect_uri`. The endpoint reference says `post_logout_redirect_uri` is ignored unless `id_token_hint` or `client_id` is sent, and that `logout_hint` needs Login V2.

One point to keep in mind. The endpoint reference says the ID token carries no `profile` or `email` claims unless "User Info inside ID Token" is enabled or the userinfo endpoint is called. The spike ([results](../results/2026-10-13-zitadel-bff-login-spike.md)) stored the email only when the ID token said `email_verified`, so the instance must already return those claims. Whether that comes from the setting or from the userinfo call is `TODO` and IAM-001 must write it into the OpenTofu code so a rebuilt instance does not lose it.

### Security record of Zitadel in 2026

The [advisory list](https://github.com/zitadel/zitadel/security/advisories) shows ten advisories between 2026-07-29 and 2026-09-28, of which two are Critical and five High. Examples are account takeover through passkey enrolment (2026-07-29, Critical), cross-organisation passkey enrolment codes (2026-08-14, Critical), manual external IdP linking (2026-09-04, Critical) and predictable session ids in Login V2 ([GHSA-jh92-5mrj-p2w2](https://github.com/zitadel/zitadel/security/advisories/GHSA-jh92-5mrj-p2w2), 2026-09-28, High, fixed in 4.19.2, and the 3.x line reached end of life on 2026-08-31). That advisory does not say whether Zitadel Cloud was affected or when it was patched (`TODO`). The [release page](https://github.com/zitadel/zitadel/releases) shows fast patching: v4.17.1 on 2026-08-14, v4.17.3 on 2026-09-04 and v4.19.2 on 2026-09-28, with v4.18.0 marked "do not use". Keycloak shows a similar volume of fixes, so this does not favour a move. It does mean the identity provider is the most exposed part of the stack, and it is the reason to keep our session layer thin and revocable.

### Authorization (STACK-023)

| Option | What the sources say | Verdict |
|---|---|---|
| Row-level security plus roles in code (current) | Built and tested. The catalog tests, the table-driven role test (ADR 0026), the mutation check in knowledge/database.md and the guest scope spike ([results](../results/2026-10-08-guest-scope-rls-spike.md)) all pass. | Keep |
| OpenFGA | The [release page](https://github.com/openfga/openfga/releases) shows regular releases (v1.19.0 to v1.22.0 between 2026-08-25 and 2026-10-06), with breaking changes in v1.19.0 and v1.22.0. It is still a separate service with its own tuples to keep in step with Postgres. It also cannot filter our rows, so it would not replace the floor. | Keep deferred |
| SpiceDB | The [release page](https://github.com/authzed/spicedb/releases) shows v1.54.0 to v1.56.2 (2026-06-18 to 2026-09-11), with a security fix in v1.56.2 and v1.54.0. Same shape and same cost as OpenFGA. | Keep deferred |
| Cedar | The [release page](https://github.com/cedar-policy/cedar/releases) shows v4.13.0 on 2026-09-15. Partial evaluation (`tpe`) is still labelled experimental. A Rust library with a Python binding to be checked (`TODO`), and it gives decisions, not row filters. | Reject for now |
| Oso | The [documentation index](https://www.osohq.com/docs) describes Oso Cloud as a hosted service. Whether the open source library is maintained, and the price, are not stated (`TODO`). A hosted authorization service is a poor fit for pathology data. | Reject |

No engine found a way to take over the tenant floor. Database row-level security is enforced below the application, which a relationship service cannot do. The questions that would trigger a change are the ones ADR 0020 already names: sharing beyond one case per grant, such as folders (IAM-016) or cross-organisation teams.

## Decision

Confirm both decisions without change.

- STACK-023 stays as ADR 0020 says. Row-level security is the floor, guest scopes are restrictive policies, roles live in code, and there is no relationship service. The code since then (ADR 0026, 0029, 0032) added rules on top without needing anything else.
- STACK-028 stays as ADR 0025 says. Zitadel Cloud, a small client on `httpx2` and PyJWT, sessions in Postgres and platform operators in our database. The features we rely on are all documented by Zitadel now.
- Keep the revisit triggers. For authorization, reconsider when IAM-016 folders or cross-organisation teams need grants that one case-scoped row cannot express. For identity, reconsider when per-organisation SSO (IAM-012) needs more than three identity providers on the plan, or when the free plan's lack of a stated uptime guarantee blocks the pilot.

## Risks found

| Risk | Detail | Tasks | Action |
|---|---|---|---|
| Free plan has no stated uptime guarantee and a 100 daily user cap | The pricing page gives an uptime guarantee and a response objective only on Pro (US$100 a month) and Enterprise. A login outage stops all clinicians. | IAM-001, IAM-012, pilot readiness | Decide before the pilot whether to move to Pro. The owner's step, and no account change is made here. |
| Many 2026 Zitadel advisories | Ten advisories in two months, two Critical. Cloud patch status is not stated. | IAM-001, IAM-009 | Keep sessions server-side and revocable. Ask Zitadel how Cloud customers are told about fixes (`TODO`). |
| Login V2 changes under us | v4.19.2 signs the Login V2 cookie and logs everyone out of the login UI once. v4.17.1 and v4.17.2 changed Login V2 and logout account selection. Our E2E test depends on the account picker after logout ([knowledge/auth.md](../knowledge/auth.md)). | IAM-002 tests, IAM-001 | The E2E job is the early warning. Keep it in CI. |
| ID token claims depend on an instance setting | `profile` and `email` claims are in the ID token only with "User Info inside ID Token" or via userinfo. | IAM-001 | Put the setting in OpenTofu, and add a test or startup check that the claims are present. |
| Logout redirect needs `id_token_hint` or `client_id` | Otherwise Zitadel ignores `post_logout_redirect_uri`. | IAM-002 | Already covered by the E2E logout test. No change. |
| Free plan limit of 3 identity providers | Per-organisation SSO for many customers could pass 3. | IAM-012 | Check the limit against the Enterprise terms before promising SSO (`TODO`). |
| Data region claim unverified for our instance | The pricing page lists EU for Free. Our instance's region is in OpenTofu, not re-read here. | IAM-001 | Confirm in the instance console (`TODO`). Read only. |

## Consequences

- No change to ADR 0020 or ADR 0025, and no backlog task needed rewriting.
- IAM-001 should record the ID token claims setting, the plan, the region and the MFA policy as code, and note the uptime question above.
- IAM-012 should check the identity provider limit before it plans per-customer SSO.
- The pilot-readiness task that covers vendors should add the Zitadel plan decision.
- This ADR measured nothing, so there is no result file. The next recheck is due when IAM-012 or IAM-016 starts, or after a Critical advisory that affects Zitadel Cloud.
