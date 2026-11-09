# 0265. Join a workspace by its verified email domain, or ask its admins

- Date: 2026-11-09
- Status: Accepted
- Deciders: agent, for the owner to review
- Backlog: ONB-010 (join or ask for a workspace and keep the setup profile)

## Context

First-run setup offers a workspace to join at once and another to ask for. ONB-004 (first-run setup) sent both through a draft that only the fake API answered, and listed the workspaces from a draft too. The real API needs a rule for which workspaces a new person may see, which ones let them in at once and which ones need someone with admin rights to say yes. It must not show a stranger every workspace on the platform. Who may create a workspace is still open in the owner's decisions and is not changed here.

## Options considered

1. Match the person's verified email domain against a domain saved on the workspace. A matching workspace lets them in at once or asks its admins, as the workspace chooses. Nothing else is listed. This is the rule most team tools use and needs no search across tenants.
2. Let a person search workspaces by name and ask any of them. This leaks which labs use Parfocal and lets anyone flood admins with requests.
3. Only invitations. This is safe but leaves the setup step with nothing to show and breaks the approved design.

## Decision

Option 1. A tenant carries `email_domain` and `join_policy` (`join` or `ask`, `join` by default as the design shows). Creating a workspace saves the creator's verified email domain, except for public mail providers such as gmail.com or seznam.cz, whose workspaces are never listed. `listJoinableWorkspaces` returns the active workspaces with the person's domain that they are not in yet. `joinWorkspace` adds them at once when the policy is `join`. `askToJoinWorkspace` saves a pending `workspace_access_requests` row, notifies every member with admin rights through the normal notification path with ids only, and `approveWorkspaceAccessRequest` adds the person. Both ways in give the reviewer role without admin rights, the least a member can hold, and an admin can raise it later.

The workspace logo is the short text mark and colour that the logo component already draws, saved on the tenant. Uploading an image logo is left for later.

## Consequences

- There is no screen yet to change a workspace's domain or policy, or to answer a request inside the app. The admin learns of a request by notification and approves it through the API.
- A request cannot be declined yet, it stays pending.
- If the owner wants joining to need approval by default, flipping the default of `join_policy` is one additive migration.
