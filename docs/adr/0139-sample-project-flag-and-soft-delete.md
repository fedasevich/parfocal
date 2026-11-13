# 0139. The sample project is a flagged project seeded on request, soft deleted, and left out of workspace-wide figures

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: ONB-005 (sample project). Feeds ONB-004 (first-run setup) and ONB-006 (getting-started checklist)

## Context

A new workspace should get a sample project with 4 CAMELYON16 slides, two result sets and a review task for the person, which they can delete and which never counts in an evaluation. A workspace is created by the platform before it has a member, so there is no person to assign the task to at that moment. There is no project delete today, only archive.

## Options considered

### Where the sample mark lives

1. A `sample` column on `projects`, with a partial unique index so a workspace holds one live sample. Every aggregate filters with one predicate, `NOT_SAMPLE` in `projects.py`.
2. A separate `sample_projects` table. Keeps `projects` unchanged but needs a join in every aggregate.

### When it is seeded

1. On request, through `POST /api/projects/sample`, which ONB-004 calls when the person picks the sample. Idempotent: a second call returns the live sample.
2. Inside `createTenant`. No person exists yet, so the task would have no reviewer.

### How it is deleted

1. Soft delete: `deleted_at` on the project, its slides and result sets, and the task archived. Retention purges them later as it does any soft-deleted slide.
2. Hard delete across every table that holds project rows, which must track every new table.

## Decision

Option 1 in each part. `DELETE /api/projects/{id}` deletes only a sample and answers `not-a-sample` for any other project. The task evaluation stays readable on the sample, so the person can try the report, and says `sample: true`. Workspace-wide figures, today the week on Home, leave sample decisions out.

## Consequences

- Every later cross-project figure (MLEVAL-009 evaluation dashboard, EVAL-004 compare two evaluations) must filter with `NOT_SAMPLE`.
- The slide rows carry no file yet, so opening one answers `slide-file-not-found` until ONB-007 (sample slide files) copies the CAMELYON16 files into storage.
