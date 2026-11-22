# 0433. Drawn objects get their own export origins

- Date: 2026-11-22
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-163 (drawn objects read as drawn in the queue, sign-off and export)

## Context

[ADR 0432](0432-drawn-objects-are-reviewed-from-a-hidden-snapshot.md) (drawn objects are reviewed from a hidden snapshot) lets a review task check outlines people drew. The training dataset of [ADR 0262](0262-training-dataset-export-as-a-zip-of-qupath-geojson.md) (the training dataset is a zip of QuPath GeoJSON) wrote a reviewed drawn outline with the origin `ai-confirmed` or `ai-edited`, so a reader of the export could not tell a person's outline from a model's by origin. The deployed walk of 2026-11-22 found this. The origin values are a published export vocabulary that people filter on and that frozen dataset versions store.

## Options considered

- Keep the AI origins and rely on the `drawn_by` and `tool` properties. Nothing changes, but every reader has to know the second property to tell the two apart.
- Add `drawn-confirmed` and `drawn-edited` beside the AI origins.
- Call every reviewed drawn object `human`. That hides whether a second person checked it.

## Decision

- The dataset origin list gains `drawn-confirmed` (a drawn outline a reviewer agreed with) and `drawn-edited` (a drawn outline a reviewer redrew or retyped). An object of the final layer is drawn when it carries the person mark and was not added by a reviewer.
- AI objects keep `ai-confirmed`, `ai-edited` and `ai-unchecked`, and added objects keep `human`.
- Both new origins are checked origins, so the default filters, the dataset counts and the manifest list them. The counts of an AI task show them as 0, and the dataset page hides a drawn origin with no objects.
- The evaluation export's object table writes `drawn` instead of `ai` in its origin column for a drawn object.
- The evaluation answer carries `ai_result`, false when no slide of the task has an AI result set, so the sign-off page leaves out sensitivity, precision, Dice and cell agreement.

## Consequences

- The export format version stays 2, because a reader that knows the old origins still reads every AI object as before.
- A dataset version frozen before this with an explicit origin list keeps that list, so it leaves drawn objects out if it is exported again. No such version holds drawn objects, because drawn review shipped the same day.
