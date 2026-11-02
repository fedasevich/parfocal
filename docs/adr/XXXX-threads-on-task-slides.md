# XXXX. Comment threads live on a task slide and show a reviewer only their own and the researcher's

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: COLLAB-002, COLLAB-003, COLLAB-005, COLLAB-006, NOTIF-007

## Context

COLLAB-002 (threads API) asks for threads anchored to an object ID, an ROI, a point or a shape, with a title, messages, resolve, reopen and a delete that asks for confirmation when replies exist. [ADR 0118](0118-blinding-and-a-kept-first-read.md) (blinding and a kept first read) says comments must follow `blinding.sees_reviewer`, and the task says a blinded reviewer sees only their own threads and the researcher's. [ADR 0091](0091-notification-catalogue-and-targets.md) (notification catalogue and targets) and [ADR 0119](0119-inbox-mutes-for-projects-tasks-and-cases.md) (inbox mutes) need a thread to resolve to its project, task and case.

`sees_reviewer` answers whether a reader sees another assignee's work on a task slide. It needs a task, and it answers no for an author who holds no assignment there, which is the usual case for the researcher.

## Options considered

Where a thread lives:

1. On a slide, with an optional task. A researcher could comment on any slide, but a thread without a task has no blinding rule, so a reviewer's thread would need a task anyway, and mutes and targets would have two shapes.
2. On a task slide. Every thread has a task, a slide and a project, so blinding, mutes, targets and the route all follow from one row. Comments on a slide outside any task wait for a later task.

Who sees a thread or a message:

1. `sees_reviewer` alone. It hides the researcher's threads from every reviewer who has not submitted, which the task rules out.
2. The author reads the whole project (owner or viewer, the researcher), or `sees_reviewer` allows the author. Each message is checked the same way, so another reviewer's reply on the researcher's thread stays hidden.

## Decision

Option 2 for both.

- `threads` holds the project, task, slide, title, anchor (`object`, `roi`, `point` or `shape`), author and resolution. `thread_messages` holds the opening message and the replies.
- A thread anchored to an AI object is hidden from a reader whose first read is open on that slide, and starting one answers 403 `ai-hidden`.
- New threads stop at sign-off, replies and resolving go on. Only the author or a project owner deletes a thread.
- A reply notifies earlier participants who can see it, with the project, task and case from the thread so a mute catches it.

## Consequences

- Migration `0075` (threads) adds both tables with tenant isolation.
- A thread on a slide outside any task, a thread mute and realtime `thread.updated` events need later tasks.
- The thread lines of ADR 0091 (a 409 `target-not-available` for threads) and ADR 0119 (threads give no context) no longer hold.
