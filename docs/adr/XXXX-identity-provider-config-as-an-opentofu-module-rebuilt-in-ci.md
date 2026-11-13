# XXXX. Identity provider config as an OpenTofu module, rebuilt from nothing in CI on a throwaway Zitadel

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-001 (identity provider deployment and configuration). Feeds OPS-001 (base infrastructure as code) and SKEL-002 (log in through the IdP).

## Context

IAM-001 is done when the IdP config is code and is recreated from scratch in CI. STACK-028 (identity provider) already put the Zitadel project and one OIDC app per environment in `infra/tofu/zitadel.tf`, inside the one state that also holds DNS and buckets. The login policy, password rules and the E2E test user were set by hand or left at instance defaults. [ADR 0041](0041-identity-and-authorization-rechecked.md) (identity and authorization rechecked) asked this task to record the ID token claims setting, the plan, the region and the MFA policy as code.

## Options considered

1. How the config is written. The Zitadel Terraform provider (3.8.7, already locked in `infra/tofu`, plans show drift, `moved` blocks keep the live apps) or an exported instance config replayed through the Management API (no provider gaps, but we would write and maintain the diff and import logic ourselves, and nothing would show drift).
2. Where CI recreates it. A scratch organisation on the Zitadel Cloud instance (the real service, but it needs an instance-level credential in CI, runs next to production users and counts against the free plan), or a throwaway self-hosted Zitadel container in the CI job (same software, no credential, no cloud touch, $0, but a pinned version that can differ from Cloud and no hosted login pages).
3. Where the code lives. More resources in `zitadel.tf` (cannot be applied to an empty instance without the rest of the root) or a module that takes an organisation id (one definition for staging, production and the scratch run).

## Decision

- The provider, in a module at `infra/tofu/modules/zitadel-identity`. It owns the project, one confidential OIDC app per environment, the organisation's login, password and lockout policies and optional test users. It has no backend and no provider block, so any root can call it.
- `infra/tofu/idp-scratch` is a root with local state that creates an organisation and calls the module with dev, preview and staging apps and the E2E user. `run.sh` starts Postgres 17.10 and Zitadel v4.20.3 from `compose.yaml`, applies, requires an empty second plan, runs `check.py`, destroys, applies again, checks again and destroys.
- `check.py` reads the result back through Zitadel's API: the three policies are the organisation's own and hold the decided values, the project is limited to its organisation, each app has its redirect URI and puts profile claims in the ID token, each client secret is accepted and a wrong one refused, and the test user's password opens a session.
- The workflow `.github/workflows/idp.yml` runs `run.sh` on every change to the module or the scratch root. It needs no secret.
- Recorded for ADR 0041: `id_token_userinfo_assertion = true` is what puts `email` and `email_verified` in the ID token, the plan is Free, the region is EU (`eu1`). The uptime question for the free plan stays `TODO`.

## Evidence

Measured on 2026-11-13 on the owner's Mac with OpenTofu 1.13.9. Two full runs of `run.sh` passed: 9 resources added, "No changes" on the second plan, all checks passed, 9 destroyed, then the same again. A read-only plan of the live root with the module wired in through `moved` blocks showed the three apps and the project moved, 3 policies to add, 1 in-place change (`has_project_check`) and 0 to destroy.

## Consequences

- The scratch run proves the code, never the Cloud instance. The image tag is bumped by hand, and a Cloud-only difference shows first in the staging plan.
- The hosted login pages are not exercised in the scratch run. The login E2E against staging still owns that.
- The workflow has not run on GitHub yet, because this branch was not pushed. The first run after the merge is the proof for "recreated in CI".
- The workflow is not part of `ci-ok`. Adding it there is the lead's call.
- OPS-001 calls the module from its roots and deletes `zitadel.tf` only together with the `moved` blocks, or the production app would be destroyed.
