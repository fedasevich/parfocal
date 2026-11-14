# 0303. A new workspace saves no mail domain, and an admin turns joining by domain on

- Date: 2026-11-14
- Status: Accepted
- Deciders: owner (decision 84a, a new workspace and its mail domain, answered 2026-11-13)
- Backlog: IAM-026 (a workspace on a shared mail domain is not open to strangers)

## Context

[ADR 0265](0265-join-a-workspace-by-verified-email-domain.md) (join a workspace by its verified email domain) saved the creator's mail domain on every new workspace with the join policy `join`. Only a hand-kept list of 32 domains and 7 prefixes kept consumer mail providers out. The [tenant isolation review](../results/2026-11-09-tenant-isolation-review.md) confirmed that on a provider missing from the list, such as `onet.pl`, `btinternet.com` or `comcast.net`, any stranger with a free mailbox saw the workspace's name, logo and counts and joined it as a reviewer.

## Options considered

1. A new workspace saves no domain. Someone with admin rights turns joining by domain on in the join settings, which already refuse a listed public domain and any domain that is not the admin's own.
2. Keep saving the domain and grow the list of public providers. The list can never be complete, so the gap stays.
3. Keep saving the domain with the policy `ask` by default. Strangers still see the workspace's name, logo and counts and can flood its admins with requests.

## Decision

Option 1. `createWorkspace` writes no `email_domain`. A workspace is listed by `listJoinableWorkspaces` and open to `joinWorkspace` or `askToJoinWorkspace` only after `setJoinSettings` saved a domain. The list of public providers stays as a second guard inside the join settings.

## Consequences

- A new workspace is closed by default. Colleagues get in by invitation until an admin opens it by domain.
- An admin on an unlisted shared provider can still open their workspace to that provider by hand. That is now a deliberate act with the domain shown on the settings screen, not a silent default.
- Workspaces created before this change keep the domain they saved. Clearing it would also clear domains admins chose on purpose, so no migration does it. TODO: the owner's test workspaces in production can be cleared in the join settings or by a reseed.
- The first-run setup step that offers workspaces to join shows nothing for a domain until an admin opened a workspace to it.
