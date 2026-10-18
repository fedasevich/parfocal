# 0072. A verdict is one current answer per reviewer, task and object with a coded reason, and the opinion form is a versioned list of four question kinds

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: GUIDE-000 (research check for verdicts and the opinion form), shapes GUIDE-001 (verdict model), GUIDE-003 (disagree reasons), GUIDE-006 (opinion form builder), GUIDE-007 (opinion form for the reviewer), TASK-001 (review task model), RSET-007 (reviewed layer), ADJ-001 (disagreement detection) and EVAL-001 (metrics)

## Context

POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) "Review" has reviewers judge each object as Agree, Disagree or Unsure with K, X and U, retype it, edit its outline, delete it or add a missing one, and give a quick reason on Disagree. Every verdict saves at once and can be changed until sign-off. The researcher builds a short opinion form per project from a default template, and its answers feed the evaluation report. The hi-fi mock (version 39) shows four reasons per kind in guided review: for a region "Not tumor", "Boundary is off", "Two regions, not one" and "Artefact or fold", and for a cell "Not a cell", "It is an immune cell", "It is stroma" and "Artefact". The full viewer offers "Not a cell", "Artefact", "Boundary off" and "Two nuclei as one". Its default form asks "Is the AI result acceptable for this slide?" on a scale of 1 to 5, "Main error type" as a choice, "Would you sign this without changes?" as yes or no, and a comment. The evaluation report counts reasons ("Why reviewers disagreed with the AI") and the 1 to 5 answers. Web forms use TanStack Form and Zod, and forms built from data are rendered from that data ([ADR 0045](0045-forms-and-validation.md)).

## State of the art

Clinical data capture tools such as REDCap and ODK describe forms as data, as a list of typed fields with options, branching and versions, and keep each answer with the version it was given against. JSON Schema driven form renderers (JSON Forms, react-jsonschema-form) can render any schema, but they bring their own widgets and validation, while ADR 0045 already renders template data with TanStack Form. Four question kinds do not need a general schema language.

## Options considered

### Verdict history

1. An append-only row per change. Every change is kept, but the current verdict needs a "latest row" query everywhere, and ADJ-001 and EVAL-001 read current verdicts all the time.
2. One current row per task, reviewer and object, with every change written to the hash-chained audit log ([ADR 0027](0027-audit-log-hash-chain-in-postgres.md)). Reads stay simple, and the history is still complete and tamper-evident.

### Reasons

1. Free text. Expressive, but the report cannot count it, and doctors asked for few clicks.
2. Four fixed codes per object kind, plus an optional note. The class names in the mock's cell reasons come from the sentinel node taxonomy, so they become one code, `wrong_class`, which carries the chosen class.

### The opinion form

1. JSON Schema with a generic renderer.
2. A small typed list of questions (scale, choice, yes or no, text), stored as an immutable version per project.

## Decision

Option 2 in each case.

Verdicts:

- `verdicts` holds one row per task, reviewer, slide and object, with `value` (`agree`, `disagree` or `unsure`), `reason` (required on disagree, otherwise empty), `reason_class_id` (only with `wrong_class`), an optional note of up to 500 characters, and the times. Clearing a verdict, which is what Undo does when there was none before, deletes the row. Every save, change and clear writes `review.verdict-set` or `review.verdict-cleared` to the audit log.
- Objects are named by their stable object ID from [ADR 0071](0071-object-id-grammar.md), so a verdict keeps pointing at T2 when a later result set carries T2.
- Verdicts apply to AI regions (T) and AI cells (C). Unsure zones (Z) are a scope that points at their cells, and regions of interest (R) and measurements (M) are made by people and are not judged.
- Fixes (a new outline, a new class, a deleted or added object) go into the reviewer's reviewed layer (RSET-007) and never change the AI set. A `wrong_class` reason and a retype in the reviewed layer are saved together.
- A verdict can change until the task is signed off. After sign-off a change is refused unless the owner reopens the task ([ADR 0069](0069-slide-pipeline.md)).

Reasons:

| Kind | Code | Shown as |
|---|---|---|
| Region | `not_class` | Not {class}, as in "Not tumor" |
| Region | `boundary_off` | Boundary is off |
| Region | `two_regions` | Two regions, not one |
| Region | `artefact` | Artefact or fold |
| Cell | `not_a_cell` | Not a cell |
| Cell | `wrong_class` | It is {class}, with the class picked from the taxonomy. Guided review offers the two most likely other classes |
| Cell | `boundary_off` | Boundary off, which includes two nuclei drawn as one |
| Cell | `artefact` | Artefact |

The opinion form:

- `opinion_forms` holds immutable versions per project. A version is a list of up to 12 questions. Each has a stable `key`, a `label` (up to 200 characters), a `kind`, `required`, and `quick` (shown among the three quick questions at the end of guided review).
- The kinds are `scale` (whole numbers from `min` to `max`, 1 to 5 by default, with optional labels for the ends), `choice` (2 to 12 options, one answer), `yesno`, and `text` (up to 2,000 characters).
- Publishing a change makes a new version. A task pins the version it was created with (TASK-001), so answers already given never change meaning.
- `opinions` holds one row per task, reviewer and slide, with the version, the answers by key, and a draft flag that turns off when the reviewer submits the slide. Text answers are classed `phi`, because in a clinical project a doctor may write identifying text.
- The default template is the mock's four questions: "Is the AI result acceptable for this slide?" (scale 1 to 5, labelled "unusable" and "sign as is", quick), "Main error type" (choice of None, Missed tumor, False tumor, Wrong cell types and Boundaries, quick), "Would you sign this without changes?" (yes or no, quick), and "Comment" (text).

## Consequences

- GUIDE-001 creates `verdicts`, GUIDE-006 creates `opinion_forms`, and GUIDE-007 creates `opinions`. The form is rendered from its data with TanStack Form, as ADR 0045 does for template data.
- ADJ-001 and EVAL-001 read current verdicts and reason codes directly. EVAL-001 counts reasons with their labels per taxonomy.
- The "Main error type" options name tumor, so a project with another taxonomy should edit them. TODO: GUIDE-006 decides whether the template should be filled in from the project's classes.
