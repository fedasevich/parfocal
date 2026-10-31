# 0118. Reviewers see each other's work after they submit, and a first read without the AI is a stored step that is kept unchanged

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: TASK-004, TASK-010, TASK-008, TASK-007, PROJ-008, EVAL-007, COLLAB-002, GUIDE-006, ADJ-001

## Context

TASK-004 (blinding and first read) asks that reviewers see others' verdicts and comments only after they submit, that the AI can be hidden for a first read and revealed afterwards, and that the researcher sees everything. POC doc 37 (the AI results review rework) says the same in its review section and calls blinding a project setting that is on by default.

Where the switches live is already settled. [ADR 0078](0078-review-task-model.md) (review task model) put `blinded` (default on) and `ai_hidden_first_read` (default off) on `review_tasks`, and gave project-level defaults to PROJ-008 (project settings). EVAL-007 (study template model and API) lists blinding and the first read as presets a study template fills into a new task. So the task holds the setting, the project holds the default and the template presets it. No new choice is needed there.

Before this change a reviewer could never read another reviewer's verdicts, layer or opinion, and nothing hid the AI. Today the API gives the AI's output to reviewers through the result set routes (counts, class lists with object counts), the reviewed-layer export (AI region outlines with their classes), the reviewed-layer summary (region and cell counts) and, indirectly, the verdict and edit writes, which answer `unknown-object` for a number the set does not have. Another reviewer's work is reachable through the verdict list, the reviewed layer, the opinion, the layer export and an added object read by its id. Comments do not exist yet (COLLAB-002, threads API).

Two questions are open. What does "reveal afterwards" mean for what the reviewer did blind, and what exactly is hidden during the first read.

POC doc 44 (round 6 working mock), written on 2026-10-31 and not yet reflected in the backlog, gives the task a decision style. Its `blind` style ("Pick the class blind") shows each object's crop and asks "What is T2?" with the AI's claim hidden, then reveals the claim. That reads "hide the AI" as hiding the claim (class and confidence) while showing the object.

## Options considered

What happens to the blind read when the AI is revealed:

1. The blind read is locked. Once revealed the reviewer can only look. Simple, but a reader study usually wants the aided read too, and verdicts on AI objects could then never be given in a task that hides the AI.
2. The first read is its own stored step. The reviewer records it, which copies what they did into the assignment and never changes again. The AI then appears, the reviewer goes on with verdicts and fixes, and submits the slide as usual. A reader study gets the unaided and the aided read of the same person on the same slide.
3. The first read is the slide submit. Submitting reveals the AI, and a reopen is the second read, with the first submit kept as a snapshot. No new route, but submitting would also reveal other reviewers' work in a blind task before the second read, and reopen already means "change my submitted review" in [ADR 0069](0069-slide-pipeline.md) (slide pipeline).

What is hidden during the first read:

1. Everything the AI produced on that slide: objects, classes, scores, probabilities, counts, class lists and exports. The reviewer reads the slide unaided, answers the opinion form and may add the objects they find, which is the classic unaided read of a reader study.
2. Only the AI's claim, as POC doc 44 (round 6 working mock) draws it: outlines and IDs stay, class and confidence go, and the first read is a class picked blind per object. This needs the decision style model of doc 44, with a raw answer per object and its mapping to agree, disagree or not sure, which no backlog task holds yet.

## Decision

Option 2 for the reveal and option 1 for what is hidden, with option 2 for what is hidden kept open for the owner.

- `review_assignments` gains `first_read_at` and `first_read`. `POST /api/review-tasks/{task}/slides/{slide}/first-read` (`submitFirstRead`) records it for the assigned reviewer in a task with `ai_hidden_first_read`, before the slide is submitted. The record holds the opinion form version, the answers as they are at that moment and the reviewer's added regions and cells with their outlines. A database trigger refuses any later change to either column, even for the table owner, so reopening a slide, reopening the task, changing the opinion or deleting an added object never touches it. `GET .../first-read` (`getFirstRead`) returns it, and `task.first-read-submitted` is audited with the question keys and the number of added objects, never the answers.
- In a task that hides the AI, every assignee records a first read before they judge AI objects or submit. Verdicts and reviewed-layer edits answer 409 `first-read-open`, and submit answers 409 `first-read-needed`. Opinion answers and added objects are allowed, because they are the first read.
- While a project reviewer's first read is open on a slide, in any task that is not archived, they get none of the AI's output for that slide. The result set routes leave the set out or answer 403 `ai-hidden`, the layer export answers 403 `ai-hidden`, and the layer summary gives no region or cell counts. References that say nothing about the output stay: the set's id in the task, and its name and status in My work. Hiding works per slide, so a second task on the same slide cannot show what the first one hides.
- Another reviewer's verdicts, layer, opinion, export, first read and added objects are open to a project reviewer only when both hold an assignment on that task slide, the AI is not hidden for the reader, and the task is not blinded or the reader has submitted the slide. A reopened slide hides others' work again until the next submit. An added object read by id answers 404 when hidden, as the list already leaves it out.
- Project owners and project viewers read everything, which is what "the researcher sees everything" means here. Admin rights add nothing ([ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md), researcher and reviewer with admin rights), so a researcher with admin rights and no project role still gets 404. A project owner named as a reviewer is not blinded by the API. Their first read is only as blind as their client keeps it.
- The disagreement queue, the task evaluation and the consensus export stay with owners and viewers, as before. Progress (who is assigned and who has submitted) is not blinded.
- `ai_hidden_first_read` can no longer be switched on or off once any reviewer has started the task (a verdict, an edit, an opinion, an added object, a first read or a submit), which answers 409 `task-started`. Blinding itself may still be switched, because lifting it is the owner's call.

Option 1 for what is hidden won for three reasons. TASK-004 and the brief say "hide the AI". Option 2 has nothing to record without the decision style model, which would be a new feature inside a blinding task. And hiding everything is the stricter rule: loosening it later to "show the outline, hide the claim" keeps every first read already collected valid, while tightening it later would not.

## Consequences

- Migration `0042` (first reads) adds the two columns, a check that they are set together, and the trigger. It follows migration `0041` (inbox mutes) from NOTIF-007 (inbox API), which follows migration `0040` (review order) from GUIDE-012 (least sure first order).
- `parfocal_api.blinding` holds every rule above. COLLAB-002 (threads API) must use `sees_reviewer` for comments, and any later route that returns AI objects, chunks, classes, scores or probabilities, such as the viewer's result reads, must use `ai_hidden` or `require_ai_shown`.
- TASK-010 (reveal the AI after a first read, end to end) is new. It holds the E2E half of TASK-004, which needs a screen.
- TODO for the owner: confirm option 2 for the reveal, and choose between the two readings of what is hidden. If the owner picks POC doc 44's reading, a new GUIDE task adds the decision style with its raw answers, the first read gains blind class picks per object, and the hiding rule shows outlines and IDs while it hides classes and scores.
- TODO for the owner: whether a reviewer who has seen others' work may reopen and change their review in a blind task. [ADR 0080](0080-disagreement-rule-and-sign-off.md) (disagreement rule and sign-off) lets reviewers reopen until sign-off, so this change keeps that, and the audit log records every change after a submit.
- GUIDE-006 (opinion form builder) and EVAL-007 (study template model and API) should know that the default form asks "Is the AI result acceptable for this slide?", which makes no sense in a first read without the AI. TODO: decide whether a form marks questions for the first read.
- TASK-007 (nudge, reassign and change a task) must not delete an assignment that holds a first read without keeping it, because the trigger guards updates only.
- ADJ-001 (disagreement detection) and the evaluation report can compare a reviewer's first read with their verdicts later. The evaluation does not read first reads yet.
