# 0283. A mention in a decision note is a `mention` on a decision target, held until its author may be seen

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: GUIDE-022

## Context

GUIDE-010 (notes on decisions) saves a note with a decision and shows `@` mentions, but tells nobody. GUIDE-022 (mentions in decision notes notify) asks for a notification. [ADR 0165](0165-mentions-in-thread-messages.md) (mentions in thread messages) refuses a mention of anyone who could not read the message, and [ADR 0118](0118-blinding-and-a-kept-first-read.md) (blinding and a kept first read) hides a reviewer's work from other reviewers until they submit. A decision has no id of its own, its key is task, slide, reviewer and object.

## Options considered

How the notification is stored:

1. A new kind such as `note-mention`. It needs a migration for the `kind` checks on `notifications` and `notification_preferences`, a template and a preference row, and readers would choose separately for two kinds of mention.
2. The existing `mention` kind with a new target type `decision`, the slide as target id and the task, object and author in the payload. `target_type` has no check, so no migration is needed.

When the notification is sent:

1. When the note is saved, to everyone mentioned. A blinded reviewer's note would reach the researcher before the reviewer submits.
2. When the note is saved and the author is not held, and again at every slide submit, to those mentioned who may see the author's decisions by then and were not told yet.

## Decision

Option 2 for both.

- The token is ADR 0165's `@[user-id]`. A note may name at most 20 people. Everyone named must be a member who opens the task slide and whom the author may see, or the decision is refused with 400 `bad-mention` and nothing is saved.
- A note is held while the task is blinded and its author has not submitted the slide. Once it is not held, a mentioned person is told when they may see the author's decisions under ADR 0118. Each slide submit looks at every note on the slide again, so a held note goes out when its author submits and a reader who could not see it is told when they submit.
- A person is told once per note. Saving the note again tells only people newly named, as ADR 0165 asks for an edit.
- `mention` breaks a mute, as the catalogue says. The payload holds ids only, never the note, and the audit keeps a `mentions` count.
- `getNotificationTarget` answers a decision target with the task, slide and object while the reader may still see the author, and `target-gone` otherwise.
- `GET /api/review-tasks/{task_id}/slides/{slide_id}/decision-notes` lists the notes the reader may see under ADR 0118, which the Comments tab shows next to the reader's own.

## Consequences

- No migration. A reopened slide hides the note again, and people already told keep their notification.
- The web app still writes mentions as names, not tokens, so the real API tells nobody until the note editor writes `@[user-id]`. TODO: a follow-up task converts names to tokens on save and back on display, for thread messages too.
