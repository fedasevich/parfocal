# 0131. A decision keeps the raw answer in the task's decision style, the study template maps it to agree, not sure or disagree, and a slide is submitted only when everything in scope is decided

- Date: 2026-11-01
- Status: Proposed
- Deciders: Yurii Fedas, in round 6 of the POC mock (POC doc 44, the round 6 working mock), written up by Claude
- Backlog: GUIDE-015 (decision styles with the raw answer and Counts as), changes TASK-001 (review task model), TASK-005 (new review task stepper), TASK-008 (submit a slide review), GUIDE-002 (guided review), GUIDE-006 (opinion form builder), GUIDE-007 (Slide done card with the opinion form), GUIDE-009 (opinion answers API), EVAL-001 (metrics engine) and EVAL-007 (study template model and API). Amends [ADR 0072](0072-decisions-reasons-and-opinion-forms.md) (decisions, reasons and opinion forms) and [ADR 0084](0084-evaluation-metrics.md) (evaluation metrics)

## Context

[ADR 0072](0072-decisions-reasons-and-opinion-forms.md) (decisions, reasons and opinion forms) gives every reviewer three answers per object, Agree, Disagree or Not sure, on K, X and U, and stores that value. [ADR 0084](0084-evaluation-metrics.md) (evaluation metrics) builds the metrics from it. Round 6 of the POC mock (POC doc 44) found that studies ask the question in different ways. A reader study wants a certainty scale. A study that must not lead the reviewer hides the AI's claim and asks for a class or a plain yes or no. The metrics, the disagreement queue of [ADR 0080](0080-disagreement-rule-and-sign-off.md) (disagreement rule and sign-off) and the report still need one three-way value per object, so that every study can be compared.

Submitting a slide is a stored move of the slide pipeline ([ADR 0069](0069-slide-pipeline.md) (slide pipeline)) with no condition on what was decided. In the mock a reviewer could submit with objects still open, and the evaluation then had holes nobody had chosen.

## Options considered

### What a decision stores

1. Keep the three buttons for every study. Nothing changes, but a reader study cannot ask for certainty and a blind study shows the claim it wants hidden.
2. Let the screen ask in any style and store only the three-way value. The data stays as it is, but the certainty is lost, and a researcher who changes what counts as agree cannot recount the answers already given.
3. Store the raw answer and the style it was given in, and derive the three-way value from a mapping that the study template sets and the task pins. The stored three-way value is kept up to date and recomputed from the raw answers when the mapping changes. Every metric reads one value, and nothing a reviewer pressed is lost.

### When a slide can be submitted

1. At any time, as today. Fast for the reviewer, but holes in the evaluation are silent.
2. Only when every object in the task's scope on the slide is decided, with Not sure counting as decided, and every required opinion question is answered. A reviewer who cannot tell still has a way through, and the gaps that remain are chosen.
3. As option 2 with Not sure not counting. Every object then has a firm answer, but reviewers are pushed to guess.

## Decision

Option 3 for what a decision stores and option 2 for submitting. Both are what the owner built and approved in round 6 of the mock.

### Decision styles

A task has one decision style, preset by its study template and editable in the New review task flow and the template editor.

| Style | Question and buttons | Keys | Counts as |
|---|---|---|---|
| 5-point certainty, the default | "AI says: Tumor, 91% sure" above "How sure are you that T2 is tumor?", then Certainly not, Probably not, Can't tell, Probably, Certainly | 1 to 5 | The template's mapping. By default 4 and 5 count as agree, 3 as not sure, and 1 and 2 as disagree |
| Agree with the AI | The claim above "Is T2 tumor?", then Agree, Disagree, Not sure | K, X, U | Fixed, each answer counts as itself |
| Yes or no | The template's question, "Is this tumor?" by default, with the AI's claim hidden by default, then Yes, No, Not sure | Y, N, U | Fixed. Yes counts as agree when the AI's claim is positive for the object and as disagree otherwise, No the other way round, Not sure as not sure |
| Pick the class blind | "What is T2?" with the claim hidden, then one button per project class and Not sure | 1 to the number of classes, U | Fixed. The AI's class counts as agree, another class as disagree, Not sure as not sure |

Every style has a Not sure path, because Not sure counts as decided. After Not sure the reviewer may add the Not sure reasons of [ADR 0095](0095-ux-round-5-upload-by-slide-and-decision-notes.md) (UX round 5, upload by slide and decision notes) plus "Need a second look". After an answer that counts as disagree the disagree reasons of ADR 0072 and ADR 0095 apply.

### The raw answer and Counts as

- A decision stores the raw answer as it was pressed, the style it was given in and the three-way value it counts as. It still stores one current answer per task, reviewer and object, and every save, change and clear is audited as ADR 0072 says.
- For 5-point certainty the mapping is two boundaries. The agree range starts at 3, 4 or 5, the disagree range ends at 1, 2 or 3, and whatever lies between counts as not sure and may be empty. A mapping must leave at least one answer counting as agree and one counting as disagree. The other styles have no mapping to edit.
- The task owner may change the mapping until sign-off. A change after answers exist writes who and when to the audit log and to the task's log, recomputes every stored three-way value from the raw answers, and adds a sentence to the report's Methods block. After sign-off it is a change after sign-off (ADJ-005). The style itself cannot change once any decision exists, because the raw answers would then mean something else.
- The disagreement queue of ADR 0080, the consensus and every metric of ADR 0084 read the three-way value, so their rules do not change. The report adds the spread of raw answers next to the three-way counts, for example the count of each certainty step.

### Submit gating

- The API submits a slide only when every object in the task's scope on it has a decision, Not sure included, and every required question of the pinned opinion form is answered. Otherwise it answers with a problem that lists the open objects and the unanswered questions. Objects a reviewer added sit outside the scope and never block, and splitting or merging an object never changes the scope count.
- On screen the primary is disabled while anything blocks. One blocker shows as the reason under it. Two or more show as a "Before you submit" list with a Go to link per row. A skipped object has a hollow dot and stays open.

## Consequences

- GUIDE-015 (decision styles with the raw answer and Counts as) is new. It adds the raw answer and the style to the decision row, the style and mapping to the study template presets of EVAL-007 and the task of TASK-001, the recompute and its log entries, and the raw spread to the evaluation of EVAL-006.
- TASK-001, GUIDE-006, GUIDE-009, EVAL-001 and EVAL-007 are ticked, so each gains a line that points at GUIDE-015 or TASK-008 instead of changing what was built.
- GUIDE-002 (guided review) asks in the task's style, TASK-005 (new review task stepper) gains the decision question with the Counts as line, and GUIDE-007 becomes the Slide done card with the opinion form.
- TASK-008 (submit a slide review) builds the gating in the API and on screen.
- Hiding the AI for a first read ([ADR 0118](0118-blinding-and-a-kept-first-read.md) (blinding and a kept first read)) with a style that shows the claim makes the first read use Pick the class blind, and the mock warns about it in the New review task flow. TODO: decide in GUIDE-015 whether the API switches the style for the first read or only the screen does.
