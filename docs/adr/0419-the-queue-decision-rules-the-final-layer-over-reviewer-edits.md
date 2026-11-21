# 0419. The queue decision rules the final layer over reviewer edits

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-149 (the final layer follows the queue decision and the queue shows a single reviewer's edits)

## Context

The deployed walkthrough of v0.35.3 found two objects whose training data contradicted the disagreement queue. An object the owner rejected after Use this outline went into the zip as `ai-edited`, because ADR 0415 (a review task's final layer is an append only snapshot per slide) counts an adjudicated disagree with a settled outline as a fix. An object where the owner agreed with the AI went in with a lone reviewer's retype and redraw, because an agreed object took the earliest redraw and retype of any reviewer, including the one the queue overruled. The queue also hid that reviewer's redraw and retype, since reviewer outlines were fetched only for objects whose outlines differ.

## Options considered

- Disagree with a settled outline. Keep it as a fix (ADR 0415), refuse Disagree once an outline is settled, or let Disagree remove the object whatever was settled. Refusing blocks an owner who settled first and changed their mind. Removing matches what the owner reads in the queue and what the walkthrough expects.
- Agree over reviewer edits. Drop every reviewer edit once the queue decides, keep all of them, or keep only the edits of reviewers who agreed. Dropping all of them turns an agreed redraw that put the object in the queue for its outline into a plain confirmation. Keeping all of them lets an overruled reviewer win. Keeping only the agreeing reviewers' edits follows the decision and keeps the shape the queue settled on.

## Decision

- A queue or adjudicator Disagree without a class answer makes the object `rejected` in the final layer, a settled outline included. A class answer still makes it `ai-edited` with that class. This replaces the line of ADR 0415 that an adjudicated disagree counts the adjudicator's outline as a fix.
- A queue or adjudicator Agree takes the settled outline and class answer first, then the earliest redraw and retype of the reviewers who agreed. Edits of reviewers who disagreed or were unsure are left out. Objects nobody adjudicated keep the rule of ADR 0415.
- The queue row lists every reviewer's final outline for any queued object, so a lone reviewer's redraw can be picked with Use this outline, and each answer carries `retyped_to`, the class the reviewer gave the object. The queue pane says what Disagree and Agree do to the training data.
- The sign-off summary gains `objects`, the objects in scope and how many no reviewer decided, and the window counts a researcher who also adjudicated once, as "by you".
- No migration. Builds made before this change keep their old content and are corrected by building the layer again on the Dataset page.

## Consequences

- The consensus export of ADR 0413 (the settled outline is a copy on the queue decision) follows the same rule for an agreed object: the settled outline first, then the earliest redraw of a reviewer who agreed when the queue decided it.
- Settling an outline and then answering Disagree drops the settled outline from the training data, and the pane says so.
