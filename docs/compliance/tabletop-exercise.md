# Tabletop exercise

A ready-to-run exercise for the [incident response runbook](incident-response.md), and the record of each time it is run. SEC-018 (incident response and breach notification runbook) asks that one exercise be recorded. None has been run yet, because it needs the people named in the runbook's roles table.

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

No exercise has been run yet. TODO: the owner runs the first one and records it here.
