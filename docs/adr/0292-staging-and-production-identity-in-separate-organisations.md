# 0292. Staging and production identity in separate Zitadel organisations, client secrets only in the encrypted state

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-001 (identity provider deployment and configuration). Feeds OPS-001 (base infrastructure as code), SKEL-001 (staging environment exists) and SKEL-002 (log in through the IdP).

## Context

Today one Zitadel Cloud instance holds one organisation, `Parfocal`, with one project and the apps `parfocal-api-dev`, `-staging` and `-prod`. Users and the login policy belong to the organisation, so every environment shares them. The E2E user `e2e-pathologist@parfocal.eu` has no second factor and its password is a CI secret, and it is a valid account for the production app. [ADR 0025](0025-zitadel-bff-login.md) (Zitadel behind the backend-for-frontend) keeps every real user in `Parfocal` until per-organisation SSO, and FastAPI is a confidential client with HTTP basic auth.

The service user `parfocal-tofu` is Org Owner of `Parfocal` only. It cannot create an organisation, and an agent must not grant rights.

## Options considered

1. One organisation, one app per environment (today). Nothing to do, but test accounts and test policy live in production's user directory.
2. One organisation, one project per environment. Separates roles and grants, but users and login policy stay shared, so it fixes nothing above.
3. Two organisations in the one instance, `Parfocal` for production and `Parfocal Staging` for dev, preview and staging, each with its own project, and each project accepting only users of its own organisation.
4. Two instances. The strongest wall, but a second service to cap and watch, and whether the free plan allows it was not checked (`TODO`).

For the client secret: basic auth with a secret Zitadel generates (what ADR 0025 built and the E2E proves) or `private_key_jwt` (no shared secret on the wire, but a key still has to be stored and the API client would change).

## Decision

- Option 3. `Parfocal` keeps only `parfocal-api-prod`. `Parfocal Staging` gets a project with `parfocal-api-dev`, `parfocal-api-preview` (development mode, the glob redirect of [ADR 0050](0050-deploy-pipeline-and-previews.md), deploy pipeline and previews) and `parfocal-api-staging`, plus the E2E user, created by the module with a password from `TF_VAR_test_user_password`.
- Each project sets `has_project_check`, which makes Zitadel refuse users whose organisation does not hold the project. SKEL-002 should also compare the `urn:zitadel:iam:user:resourceowner:id` claim with the expected organisation, so the wall does not rest on one switch. That the switch refuses a foreign user was not tested here (`TODO` in SKEL-002).
- A second service user, `parfocal-tofu-staging`, is Org Owner of `Parfocal Staging` only. The key CI later uses for staging can then never change production.
- The client stays confidential with basic auth. Zitadel generates the secret. It exists in the OpenTofu state, which is encrypted with AES-GCM and kept in the `parfocal-tfstate` bucket, and in the places that consume it: the local `.env` for dev, GitHub Actions secrets for the E2E job, and per-environment GitHub secrets that the deploy copies into a Modal secret (ADR 0050). It is never committed and never printed. Read it with `tofu.sh output -json`.
- The test user's password is write-only in the provider and is not stored in the state.
- Rotating a secret means replacing the app, which is a destructive production action and is asked first ([ADR 0115](0115-production-access-and-spend-caps.md), production access and spend caps).

## Migration, in order

1. The owner creates `Parfocal Staging` and `parfocal-tofu-staging` in the console and saves its key.
2. OPS-001 calls the module for the staging organisation and applies. This only adds, outside production.
3. `.env` and the CI secrets move to the new dev app and the new test user.
4. OPS-001 calls the module for `Parfocal` with `moved` blocks and applies. This adds the three policies and turns on `has_project_check`, with nothing destroyed.
5. The old dev and staging apps and the old E2E user in `Parfocal` are removed. This destroys, so the owner is asked with the plan.

Until step 1, the module can be called once for `Parfocal` with all three environments, which is what the read-only plan in the module ADR showed.

## Consequences

- Production's directory holds no shared-password account without a second factor after step 5.
- Staging can try a stricter or looser login policy without touching production.
- Per-organisation SSO (IAM-012) will need a project grant for each customer organisation, because of `has_project_check`.
- Anyone can still register in either organisation, since sign-up runs on the hosted pages ([ADR 0267](0267-sign-up-and-setup-flow.md), sign-up and setup flow). A registered staging account reaches nothing in production.
