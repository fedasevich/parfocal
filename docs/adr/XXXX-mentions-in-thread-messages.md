# XXXX. A mention is a user ID token in the message text, and it is refused for anyone who could not read the message

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: COLLAB-006, GUIDE-010

## Context

COLLAB-006 (mentions) lets a message in a thread name colleagues so that they are notified. [ADR 0152](0152-threads-on-task-slides.md) (comment threads live on a task slide) fixes who sees a thread or a message, and [ADR 0118](0118-blinding-and-a-kept-first-read.md) (blinding and a kept first read) says a blinded reviewer must not learn that another reviewer exists. A mention must not open a way around either rule. GUIDE-010 (notes on decisions) will reuse the same token.

## Options considered

How a mention is stored:

1. A separate `mentions` list in the request, next to the text. The text and the list can disagree, and a migration adds a column or a table.
2. A token `@[user-id]` inside the text. The text is the only source, nothing is stored twice, and no migration is needed. The client shows the token as the person's name.

What happens when someone cannot be mentioned:

1. Drop them silently. The author believes a colleague was told when they were not.
2. Refuse the whole message with 400 `bad-mention`.

## Decision

Option 2 for both.

- The server reads every `@[user-id]` token from the text, once per person and in order of appearance. A message mentions at most 20 people. Mentioning yourself is allowed and tells nobody.
- Everyone mentioned must be a member of the tenant who can open the task slide, who sees the thread and the author's message under blinding, and whom the author is allowed to see. Otherwise the message is refused and nothing is saved.
- `GET /api/review-tasks/{task_id}/slides/{slide_id}/threads/mentionable` lists the people the signed-in reader may mention, with name, initials and colour, for the composer's picker.
- A mention sends `mention`, which breaks a mute as the catalogue says. A person who is both mentioned and a follower gets only the `mention`, not a `reply` as well.
- The audit keeps only how many people were mentioned.

## Consequences

- No migration. The mentioned people of a message are always derived from its text, and a response carries them as `mentions`.
- A person who later loses access to the slide still has their ID in old text. They are not notified again, because notifying happens only when a message is posted.
- Editing a message is not built. When it is, an edit that adds a mention must run the same check and notify only the people newly added.
