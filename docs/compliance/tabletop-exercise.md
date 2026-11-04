# Tabletop exercise

A ready-to-run exercise for the [incident response runbook](incident-response.md), and the record of each time it is run. SEC-018 (incident response and breach notification runbook) asks that one exercise be recorded. The first was run on paper on 2026-11-04, see Records.

## How to run it

- Time: about 90 minutes.
- People: the incident lead, the deputy, the privacy contact, and counsel if possible. One extra person acts as facilitator and reads the injects. An agent can play facilitator from this page.
- Rules: talk through what you would do, do not touch any real system, and use the runbook as written. Where it fails you, write that down. That is the point of the exercise.
- Materials: the runbook, the [register template](incident-register.md#template), [subprocessors.md](subprocessors.md), a clock.
- The facilitator reads each inject, waits for the team's answer, and asks the questions under it.

## Scenario: another workspace's slides in a reviewer's task list

The scenario is made up. It is set after the first tenant with real patient data, with two clinical workspaces, called A and B here.

### Inject 1, Monday 09:10 UTC

A reviewer in workspace A emails Parfocal's support address. Their task list shows three slides they do not recognise, with patient initials on the label thumbnails. They opened one before writing.

Questions:

1. Who receives this email today, and how does it reach the incident lead?
2. Is this an incident? Which severity, and why?
3. Open a register entry. What do you write as first notice and as awareness?

### Inject 2, Monday 10:30 UTC

The technical responder finds that a deploy on Friday 16:00 UTC changed a review task query. The query lost its project filter. Alone that would stay inside workspace A, because row level security holds the workspace scope. But the three slides belong to workspace B. A second look shows that a background job set the tenant with a session level setting instead of `SET LOCAL`, so a pooled connection carried workspace B's scope into a request from workspace A ([platform.md](../knowledge/platform.md#tenant-context-must-use-set-local-behind-the-neon-pooler)).

Questions:

1. How do you contain it in the next hour? Which of your actions need the owner's yes for that one action?
2. Which evidence do you preserve, and in which order? What expires soonest?
3. How do you find every request that may have crossed tenants since Friday?

### Inject 3, Monday 14:00 UTC

The audit log shows that the reviewer opened one slide of workspace B for 40 seconds. Two other people in workspace A had the same slides in their lists but did not open them. The label thumbnails show patient initials and a barcode.

Questions:

1. Is this a personal data breach under Art. 4(12)? Whose?
2. Parfocal is processor for both workspaces. Who must you tell, by when, and what goes in that notice?
3. What does workspace B, as controller, need from you to decide on its own 72 hours?
4. Is the risk to patients high? Does any Art. 34(3) exception apply?

### Inject 4, Tuesday 08:00 UTC

Workspace B's data protection officer replies and asks for the full list of patients whose slides were shown, by name, sent by email.

Questions:

1. What do you send, and how, without putting PHI in an email or in the register?
2. Workspace B also asks whether Parfocal will notify the authority. What do you answer?

### Inject 5, Thursday 09:00 UTC

The fix is deployed with a test. Workspace B notified its authority on Wednesday. The incident lead wants to lift the legal hold.

Questions:

1. Who must agree before the hold is lifted?
2. What goes into the review, and which backlog tasks come out of it?
3. What in the runbook was missing or wrong?

## Record template

Copy this block under "Records", newest first, after each run. Write only what happened in the room.

```
### Tabletop YYYY-MM-DD · Scenario name

- Facilitator:
- Participants and their roles:
- Duration:
- Scenario: link to the section above, or the variant used

What the team did at each inject:

1. 
2. 
3. 
4. 
5. 

Where the runbook helped:

- 

Where the runbook failed or was unclear:

- 

Actions:

| Action | Owner | Backlog task or date |
|---|---|---|
| | | |

Runbook changes made after the exercise:

- 
```

## Records

### Tabletop 2026-11-04 · Another workspace's slides in a reviewer's task list

- Facilitator: a Parfocal agent session, at the owner's request (decision 42).
- Participants and their roles: the same agent session played the incident lead, the technical responder and the privacy contact by following the runbook as written. The owner, who holds those roles, was not in the room. There is no deputy and no counsel yet.
- Duration: one pass through the five injects, on paper.
- Scenario: [the scenario above](#scenario-another-workspaces-slides-in-a-reviewers-task-list), unchanged.

What the team did at each inject:

1. The email would reach `support@parfocal.eu`, which does not exist until OPS-013 (email routing for support and security) routes it to the owner's inbox. Severity SEV1, because another workspace's patient data is shown. The register entry takes 09:10 as first notice and also as awareness, because the reviewer already saw patient initials, which is the stricter reading of the clock.
2. Containment within the hour is a rollback deploy of Friday's change and a fix of the job to `SET LOCAL`, both additive and covered by ADR 0151 (standing approval within $30 a month). A legal hold goes on both workspaces. Nothing needs deleting or rotating, so no single action needed the owner's separate yes. Evidence first from the sources that expire soonest, the edge and container logs, then a Neon branch of production as a snapshot, then the audit log, which is kept. Finding every crossed request means comparing each audit event's actor workspace with its target workspace since Friday 16:00 UTC, and there is no ready query for that.
3. It is a breach of workspace B's data, for which B is controller and Parfocal processor. Parfocal tells B within 24 hours of awareness, so by Tuesday 09:10 UTC, with the four items of the notice section and the incident ID. Workspace A is told too, so it can ask its reviewer to keep nothing. One reviewer, a health professional, saw initials and a barcode for 40 seconds, so the risk to patients is likely not high, but that is B's call as controller.
4. No names by email. Parfocal sends B the slide and case IDs through the workspace itself, and B looks the patients up in its own records. The register keeps only counts. To the second question, Parfocal does not notify an authority for B's data, B does, and Parfocal answers B's questions so it meets its own 72 hours.
5. The runbook says counsel agrees before the hold is lifted, and there is no counsel. The review lists the timeline, the cause (session level tenant setting behind the pooler), the fix and its test, and the follow-up tasks below.

Where the runbook helped:

- The severity table and the clock table gave the answers to injects 1 and 3 without debate.
- The split between processor and controller duties answered inject 4 directly.
- The rule that only deletes, rotations, purges and resets need a separate yes kept containment fast.

Where the runbook failed or was unclear:

- The support and security mailboxes do not exist yet, so the first report would be lost.
- Lifting the legal hold needs counsel, and none is retained.
- A workspace has no security contact to send the notice to.
- There is no ready query for audit events that cross workspaces, and no alert for them.
- One person holds every role, so a breach while the owner is away has nobody to decide.

Actions:

| Action | Owner | Backlog task or date |
|---|---|---|
| Route `support@` and `security@parfocal.eu` to the owner's inbox | Agent, owner verifies the address once | OPS-013 (email routing for support and security) |
| Add a security contact to each workspace | Agent | SEC-029 (security contact for each workspace) |
| Name counsel, the supervisory authority and the national CSIRT | Owner | SEC-030 (legal review of the GDPR documents before the first real tenant) |
| Alert on audit events whose actor and target workspaces differ, and keep the query in the runbook | Agent | OPS-007 (alerting and on-call) |
| Name a deputy | Owner | When a second person joins |

Runbook changes made after the exercise:

- Recover: while no counsel is retained, the affected controller's written agreement lifts the legal hold.
- Notices go to the workspace owners until SEC-029 adds the security contact.
