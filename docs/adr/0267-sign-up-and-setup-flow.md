# 0267. The sign-up and setup flow on top of the Zitadel login and invitations

- Date: 2026-11-09
- Status: Accepted
- Deciders: agent, for the owner to review
- Backlog: ONB-000 (onboarding research check)

## Context

Onboarding was built screen by screen while the research check stayed open. This record writes down the flow as built, so the remaining onboarding work has one reference. It stands on two earlier pieces. IAM-002 (login, logout and session refresh through the BFF) runs the Zitadel code flow in FastAPI and gives the browser only a session cookie ([ADR 0025](0025-zitadel-bff-login.md), Zitadel behind a backend-for-frontend). IAM-007 (invitations) binds an invitation to a verified email address and creates the membership when a signed-in person with that address accepts ([ADR 0030](0030-invitations-bound-to-verified-email.md), invitations bound to a verified email).

## Options considered

1. One entry for everyone. Every new person signs up, then setup decides what happens next, whether they came from an invite link, a matching email domain or nothing.
2. Separate entries by origin, one for invited people, one for lab members and one for founders, each with its own screens.
3. Admins create every account. This is safe but leaves a researcher unable to try the platform alone, and breaks the approved design.

## Decision

Option 1. The flow, as built, is this.

- Sign-in (ONB-001, sign-in screens) offers single sign-on first when the email domain matches an institution, then email with password, a sign-in link with a code, and forgot password with a reset checked for length, reuse and leaks. A same-site return link brings the person back to the deep link they started from, and outside targets are ignored.
- Sign-up (ONB-002, sign-up and email confirmation) asks for name, work email, password or single sign-on and what the person mostly does, then a six-digit code with resend and change address. It ends on the first setup step. The error states are a missing name, a bad email, a short, reused or leaked password, missing consent and an existing account.
- An invite link (ONB-003, invite landing, and IAM-007) shows who invited, the project and task, the work, the due date, blinding and privacy mode. The person signs up or signs in with the invited address, joins in one step and lands on the first slide. Setup is not forced on them first.
- First-run setup (ONB-004) has five skippable steps. Role and specialties, then the workspace (join, ask or create), then the first project (sample, new or later), then the input device and theme, then a checklist that ends in the chosen place. The role sets the home layout and the recommended first project.
- Joining or asking (ONB-010, join or ask for a workspace, and [ADR 0265](0265-join-a-workspace-by-verified-email-domain.md), join by verified email domain) lists only workspaces that carry the person's verified email domain. The workspace's policy lets them in at once as a reviewer or sends a pending request to every admin. Public mail domains are never a lab domain. Specialties are kept on the person.
- Creating a workspace (ONB-004) happens in one transaction. The creator becomes a researcher with admin rights whatever role they picked ([ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md), researcher and reviewer with admin rights), and setup says so. The owner kept the rule that anyone signed in may create one workspace.
- After setup, new workspaces get a sample project of four CAMELYON16 slides that no evaluation counts (ONB-005, sample project, and ONB-007, sample slide files), and Home shows a getting-started checklist ticked by real actions until each item is tried or the person hides it (ONB-006).

The order of precedence when several routes apply is fixed. An invite link wins over a domain match, because the invitation already names the role and the work. A domain match wins over creating a new workspace, because setup lists matching workspaces before offering to create one.

What is still draft. The sign-in and sign-up screens run against draft auth calls answered only by the fake API. The real Zitadel-hosted pages and the code confirmation arrive through the IAM-002 login. The screens keep their approved layout and swap the calls without a redesign.

What remaining work adds. ONB-011 (answer workspace asks and set the join domain in Admin) is planned and will add a Join requests list with Approve and Decline, the email domain, join policy and image logo settings, and refuse a public mail domain. PILOT-001 (user help and onboarding) and PILOT-004 (pilot data onboarding) are ready and build on this flow for the first pilot lab.

## Consequences

- There is one sign-up path. Anything new, such as a lab domain claim, hooks into setup's workspace step and does not add a second entry.
- Until the real login replaces the draft calls, sign-up and sign-in are proven only against the fake API, and an end-to-end run against Zitadel is still owed.
- Declining a request and changing a workspace's domain or policy have no screen until ONB-011 lands. Admins answer asks only through the API until then.
- Joining by domain trusts the identity provider's verified-email claim. A provider that stops sending it would stop the join, and the invitation route would still work.
