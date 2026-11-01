# 0133. The researcher decides queued objects in the task's decision style, may leave some open on purpose, and sends others to an adjudicator who sees the reviewers only as A and B

- Date: 2026-11-01
- Status: Proposed
- Deciders: Yurii Fedas, in round 6 of the POC mock (POC doc 44, the round 6 working mock), written up by Claude
- Backlog: ADJ-007 (queue decisions in the task's style and leaving open), ADJ-008 (send to an adjudicator), changes ADJ-001 (disagreement detection), ADJ-002 (disagreement queue), ADJ-003 (adjudicator view), ADJ-004 (sign-off as a soft lock) and ADJ-006 (decisions on queued objects). Amends [ADR 0080](0080-disagreement-rule-and-sign-off.md) (disagreement rule and sign-off)

## Context

[ADR 0080](0080-disagreement-rule-and-sign-off.md), the owner's own choice, queues an object when its reviewers differ or more than half disagree with the AI, lets the researcher or an adjudicator decide it as "keep the AI's call" or "go with the reviewers", and allows sign-off only when no queued object is undecided. Round 6 of the POC mock (POC doc 44) ran the queue of one task end to end and changed four things. A reviewer who answers Not sure with the reason "Need a second look" asks for the object to be looked at. The researcher decides in the same style the reviewers had, so a decision on a queued object is as fine-grained as theirs. Some objects are better left open on purpose than forced. And the adjudicator is chosen from the queue, for several objects at once, and must not know who said what.

## Options considered

1. Keep ADR 0080 as it is. Nothing changes, but "Need a second look" does nothing, a researcher who cannot decide an object cannot sign off, and the two fixed choices lose the certainty the task asked for.
2. Take the mock's four changes and keep the rest of ADR 0080. The queue answers the reviewers' requests, sign-off is possible with open objects that the report names, and the adjudicator sees the evidence without the people.
3. Allow sign-off with any undecided object, as option 2 of ADR 0080 had it. Fewer clicks, but an object nobody looked at and one left open on purpose would look the same.

## Decision

Option 2, which the owner built in the mock. It changes a choice the owner made in ADR 0080, so it stays Proposed until the owner confirms it.

- An object is also queued when any reviewer answered Not sure with the reason "Need a second look". The two rules of ADR 0080 stay. A row shows why it is queued as "reviewers differ", "both vs AI" or "second look asked", and second look rows count under the Reviewers differ filter.
- The researcher decides a queued object with the buttons of the task's decision style ([ADR 0131](0131-decision-styles-raw-answers-and-submit-gating.md)). The decision stores the raw answer and the value it counts as, sits in its own column next to the reviewers' decisions and never replaces them. The stored "keep the AI's call" and "go with the reviewers" read as agree and disagree.
- The researcher may leave a queued object open on purpose, with an optional note. It leaves the open count, the sign-off step lists it as an allowed warning ("2 objects left open on purpose") and the report names it.
- Sign-off needs every slide submitted by every assigned reviewer and every queued object decided or left open on purpose. An object sent to an adjudicator and not decided yet still blocks.
- The researcher selects one or more queued objects and sends them to one adjudicator, a member who is not a reviewer of the task, with an optional note of up to 300 characters. A person who is away can be picked with a warning. The adjudicator may decline with a note, and the rows then say so and can be sent to someone else.
- The adjudicator sees the reviewers as Reviewer A and Reviewer B, fixed per task and not per object, so they cannot be paired across objects. No name or avatar reaches the adjudicator, notes show without their author, and the adjudicator cannot edit outlines or classes. The adjudicator's decision is a third column and replaces neither reviewer's.
- When an object is redrawn after both reviewers decided, its row is tagged "edited after decisions", and the researcher either asks both to look again, which reopens both decisions with a note, or keeps them.

## Consequences

- ADJ-007 (queue decisions in the task's style and leaving open) and ADJ-008 (send to an adjudicator) are new for the API. ADJ-001 and ADJ-006 are ticked, so each gains a line pointing at ADJ-007.
- ADJ-002 (disagreement queue), ADJ-003 (adjudicator view) and ADJ-004 (sign-off as a soft lock) follow the mock.
- The researcher sees the reviewers' names in the queue, because the researcher is not blinded.
- The evaluation's consensus of [ADR 0084](0084-evaluation-metrics.md) takes the queue decision's mapped value, and an object left open on purpose is counted as undecided and named in the report.
