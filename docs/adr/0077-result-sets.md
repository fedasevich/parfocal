# 0077. A result set is an immutable import or run on one slide, with its class list and counts

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: RSET-001, RSET-003, RSET-009, TASK-001, AIP-008

## Context

RSET-001 asks for result sets per slide with the model name and version, the date, the source file or run, whether it was imported or run here, the class mapping, the object count and stats, and AI output that cannot be edited. [ADR 0076](0076-annotation-and-ai-result-storage.md) put cells in chunks in object storage with an index row per chunk, and regions and zones in PostGIS rows. Imports run as jobs in the worker ([ADR 0044](0044-background-jobs-and-workflows.md), [ADR 0070](0070-result-file-parsers.md)), so a set exists before its objects do. RSET-001 also asks for a confirmation before deleting a set that has reviews, but reviews belong to review tasks, and TASK-001 (review task model) depends on RSET-001.

## Options considered

1. Create the set and its objects in one request. Simple, but a million cells do not fit in a request, and imports are jobs.
2. Create the set in an `importing` state through the API or a job, let the worker add its objects, then mark it `ready` or `failed`. Objects can be added only while the set is importing, and nothing can change them afterwards.
3. Allow edits to AI objects and keep a history, like annotations. Reviewer corrections would overwrite the AI output, which RSET-007 (reviewed layer) forbids.

For deletion: a hard delete loses what reviewers saw, and a soft delete keeps the rows until retention (SEC-006) removes them.

## Decision

Option 2 with a soft delete.

- `result_sets` holds the slide, the name, the model version, the source (`import` or `run`), the source file name, when the output was produced, the status, the cell, region and zone counts, the job that fills it and who created it. The source file name is `phi`, because file names often carry accession numbers.
- `result_set_classes` holds the set's class list in chunk order (index 0 to 254, 255 is unclassified in chunks), each source class name, the project class it maps to and its object count. The mapping can change later, because it says what the AI meant and does not change the output. The source names cannot change.
- `result_objects` holds regions and zones, and `result_chunks` the chunk index, as ADR 0076 describes.
- The database enforces immutability. Rows of `result_objects`, `result_chunks` and `result_set_classes` can be inserted only while their set is `importing`, and `result_objects` and `result_chunks` can never be updated or deleted by the app role. A set's status moves only from `importing` to `ready` or `failed`, and once it leaves `importing` only its `deleted_at` may change.
- The API creates imported sets for project owners and service accounts with `upload-slides`, lists them per slide and per project, shows one with its classes, and soft-deletes it. Sets made by AI runs here are created by the run job (AIP-008) with source `run`.
- The confirmation before deleting a reviewed set moves to a new task, RSET-009 (confirm deleting a reviewed result set), which depends on TASK-001, because "has reviews" means a review task or a verdict uses the set.

## Consequences

- RSET-003 (readers) creates or receives a set in `importing`, writes chunks and region rows through `parfocal_api.result_sets` helpers, then finishes the set with its counts. A failed import marks the set `failed` with an error code, and its partial rows stay for the error report.
- TASK-001 references a result set and refuses a set that is not `ready` or is deleted.
- RSET-009 adds `confirm=true` on `deleteResultSet` when a task or verdict refers to the set, and its tests.
- Chunk files are not removed by a soft delete. Removing them is SEC-006 (retention).
