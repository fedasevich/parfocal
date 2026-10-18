# 0080. Disagreements are reviewers who differ or a majority against the AI, and sign-off needs every slide submitted and an empty queue

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADJ-000, ADJ-001, ADJ-002, ADJ-004, ADJ-005, TASK-002, GUIDE-001, RSET-007

## Context

ADJ-000 must record the disagreement rule and what sign-off locks, including when sign-off is allowed, which [ADR 0069](0069-slide-pipeline.md) left to the owner. POC doc 37 says that when every reviewer has submitted, objects where reviewers disagree with each other, or with the AI above a threshold, go into a queue that the researcher resolves or sends to an adjudicator, and that sign-off is a soft lock: the owner can still change things, every change is logged and the report marks what changed after sign-off. [ADR 0072](0072-verdicts-reasons-and-opinion-forms.md) refuses verdict changes after sign-off unless the owner reopens the task. The owner chose the options below on 2026-10-18.

## Options considered

When an object is queued:

1. Reviewers give different verdicts, or more than half of the object's reviewers disagree with the AI.
2. Reviewers give different verdicts, or every reviewer disagrees with the AI. Fewer items, but two of three reviewers rejecting the AI would pass unnoticed.
3. Only when reviewers give different verdicts. Unanimous rejection of the AI is reported but never decided.

When sign-off is allowed:

1. Only when every assigned reviewer has submitted every slide and no queued object is undecided.
2. When every slide is submitted, with undecided objects listed as open in the report.
3. Any time, with a warning listing what is unfinished.

## Decision

Option 1 in both cases, as the owner chose.

- An object in a task is queued when every reviewer assigned to its slide has submitted that slide, and either the reviewers' verdicts are not all the same, or more than half of them are `disagree`. `unsure` counts as a verdict of its own, so `agree` and `unsure` differ. An object that only one reviewer judged is queued only by the majority rule, which for one reviewer means a `disagree`. Objects nobody judged are not queued, and the scope (TASK-003) decides which objects should have been judged.
- A queued object leaves the queue when the researcher decides it (keep the AI's call or go with the reviewers) or an adjudicator decides it. Decisions sit next to the verdicts and never replace them (ADJ-002).
- Sign-off is allowed only when every assigned reviewer has submitted every slide of the task and no queued object is undecided. The sign-off step lists what is missing otherwise and refuses.
- Sign-off is a soft lock. Reviewers can no longer change verdicts, opinions or their reviewed layer, and cannot reopen a submitted slide. The owner can still change things, each change is logged and flagged in the report (ADJ-005), and the owner can reopen the task, which lifts the lock for everyone.

## Consequences

- ADJ-001 implements the queue rule above with a unit test per kind, and ADJ-004 checks the two conditions before signing.
- TASK-002 can now be built. Its move table refuses sign-off while a slide is unsubmitted or a queued object is undecided, and refuses a reviewer's reopen after sign-off.
- GUIDE-001 and RSET-007 refuse reviewer changes on a signed-off task. The RSET-007 check waits for the sign-off record of ADJ-004.
- The ADR 0069 TODO on when sign-off is allowed is closed.
