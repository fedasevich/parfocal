# 0278. A decision note stays on the decision and shows in the Comments tab as an entry above the thread

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: GUIDE-010

## Context

GUIDE-010 (notes on decisions) lets a reviewer add a short note and quick reasons to a decision in guided review, the full viewer and the cell view. [ADR 0095](0095-ux-round-5-upload-by-slide-and-decision-notes.md) (upload by slide and decision notes) says the note shows as a thread on the object in the Comments tab and under each reviewer's decision in the disagreement queue and the adjudicator view, blinded there. The note already has a column on the decision row, so the question was whether to also write it as a thread message.

## Options considered

1. Write each note as a message in the object's thread as well as on the decision. The note would be stored twice and an edit of one would not change the other.
2. Keep the note only on the decision row and show it in the Comments tab as a "Decision notes" entry above the object's thread, with Edit for the reviewer's own note.

## Decision

Option 2.

- The note, its quick reasons and the decision are one row, so editing or clearing the decision changes the note in one place. Saving a note saves the decision again with the note and the reason codes, which also fixes Unsure reasons that were kept only in the browser.
- The Comments tab shows the reviewer's own note as an entry with avatar, name, decision, reasons and text. Edit opens the same field in the Objects tab.
- Mentions use the same typed form as comments, an at sign and the person's name, chosen from the same picker. A reviewer who reviews blind cannot be picked.
- The disagreement queue and the adjudicator view read the note from the decision row. The adjudicator view keeps reviewers as A and B.

## Consequences

- Other reviewers' notes appear in the Comments tab only after the API can return them under blinding for a reader. Until then the tab shows the reader's own note.
- A mention in a note does not notify anyone yet. The notification would need a target kind for a decision and the check from [ADR 0165](0165-mentions-in-thread-messages.md) (a mention is a user ID token), which is a follow-up.
- No migration.
