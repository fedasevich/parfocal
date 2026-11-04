# XXXX. Comment threads live on any slide, and the task is optional

- Date: 2026-11-04
- Status: Accepted
- Deciders: owner
- Backlog: COLLAB-015 (threads on any slide). Supersedes the "where a thread lives" part of [ADR 0152](0152-threads-on-task-slides.md) (threads on task slides). Touches COLLAB-003 (comment tool and pins), COLLAB-005 (comments tab) and NOTIF-007.

## Context

ADR 0152 put every thread on a task slide, so blinding, mutes, notification targets and the route all follow from one row, and it left a thread on a slide outside any task to a later task. On 2026-11-04 the owner answered decision 31 with b: people must be able to comment on any slide, even when no task covers it. The sign-off rule of ADR 0152 (new threads stop at sign-off, replies and resolving go on) was not questioned and stays.

## Options considered

1. Keep threads on task slides only. Simple, but a researcher cannot discuss a slide before a task exists, which the owner rules out.
2. A thread on a slide with an optional task. A thread with a task keeps every rule of ADR 0152. A thread without one needs its own visibility rule, mutes by project and case only, and a target that opens the slide without a task.
3. A second, separate table for slide threads. Two shapes for the Comments tab, the notifications and the audit, for no gain over a nullable column.

## Decision

Option 2.

- `threads.task_id` becomes nullable. A thread always has a project and a slide. The API takes the task as optional when a thread is created on a slide.
- A thread with a task keeps every rule of ADR 0152: blinding through `sees_reviewer`, the AI object rule and the sign-off rule.
- A thread without a task is seen by everyone who can read the slide in the project, with one exception. A reader whose first read is open on that slide in any task sees only their own taskless threads and those whose author reads the whole project (owner or viewer), so a slide thread cannot leak another reviewer's work into a blind first read. The AI object rule applies the same way.
- A taskless thread has no sign-off, so new threads and replies are never stopped by one. Archiving the project ends new threads and replies, as it ends every other write.
- Notifications on a taskless thread carry the project and the case, so a project or case mute catches them, and the target opens the slide with no task.
- Only the author or a project owner deletes a thread, as before.

## Consequences

- A migration makes `threads.task_id` nullable and adds an index on project and slide for taskless threads.
- The Comments tab of the full viewer lists the slide's taskless threads with the task's threads, marked "Slide" or with the task name.
- The thread lines of ADR 0091 (notification catalogue and targets) and ADR 0119 (inbox mutes) are read with a task that may be missing.
- COLLAB-015 builds the API and UI change. ADR 0152 keeps its status for the parts this record does not change.
