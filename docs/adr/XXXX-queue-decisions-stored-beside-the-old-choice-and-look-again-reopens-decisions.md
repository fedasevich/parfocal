# XXXX. A queue decision keeps the old choice column beside the new answer, and Ask both to look again marks the reviewers' decisions reopened instead of deleting them

- Date: 2026-11-03
- Status: Accepted
- Deciders: Claude, building ADJ-007 (queue decisions in the task's style and leaving open) under the proposed [ADR 0133](0133-queue-decisions-in-the-task-style-left-open-and-anonymous-adjudicators.md) (queue decisions in the task style, left open and anonymous adjudicators)
- Backlog: ADJ-007 (queue decisions in the task's style and leaving open)

## Context

ADR 0133 has the researcher decide a queued object with the buttons of the task's decision style, leave an object open on purpose, and answer an object redrawn after its reviewers decided by either asking both reviewers to look again or keeping their decisions. Rows decided before it hold only the old two choices, "keep the AI's call" and "go with the reviewers". Two storage choices follow, and both are costly to undo once production holds decisions.

## Options considered

1. Replace the old `decision` column with the raw answer, converting old rows to a made up answer. One shape, but the old choice is lost and an agree style answer would be invented for tasks that never had that style.
2. Keep the old `decision` column, make it nullable, and add `style`, `answer`, `answer_class_id`, the counted `value`, `left_open` and `edits_settled_at` beside it. Old rows keep their choice and get the value it counts as, agree or disagree.
3. For Ask both to look again, delete both reviewers' decisions on the object so they must answer afresh. Simple, but the evidence of what they said about the old outline goes, and the queue drops the object until they answer.
4. For Ask both to look again, mark both decisions with `reopened_at` and the researcher's note, keep them, and clear the mark when the reviewer answers again.

## Decision

Options 2 and 4.

- `disagreement_decisions` keeps the old choice, and the API reads it back as `choice` with the value it counts as. New decisions store the style, the raw answer, the picked class on a blind task and the counted value. A certainty decision is recounted when the task's Counts as changes, as reviewers' decisions are.
- Leaving open is a row with `left_open` and an optional note and no value. Undoing it, like undoing a decision, deletes the row unless it also records that the edits were settled.
- An object is edited after decisions when a reviewer's redrawn outline of it is newer than the last submission of its slide and newer than the researcher's last look again or keep. Keeping sets `edits_settled_at`. Looking again sets it too, marks both reviewers' decisions reopened with the note and clears the researcher's decision, which was about the old outline.
- A reopened object counts as open, so it blocks sign-off, and the researcher cannot decide or leave it open until both reviewers answered again. The reviewers' slides stay submitted, so other queued objects on the slide stay in the queue.

## Consequences

- The evaluation takes the counted value of a queue decision, which now also overrides a unanimous reviewer value such as both against the AI. An object left open counts as undecided.
- The decision list returns the reopened mark and note, and the reviewer screens still have to show them.
- A later migration can drop the old `decision` column only after every old row has a value, which this migration already fills.
