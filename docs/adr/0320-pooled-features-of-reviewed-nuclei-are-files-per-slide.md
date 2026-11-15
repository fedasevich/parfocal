# 0320. Pooled features of reviewed nuclei are files per slide

- Date: 2026-11-15
- Status: Accepted
- Deciders: Claude, waiting for the owner
- Backlog: AILEARN-010 (collect pooled features of reviewed nuclei for training rounds), AILEARN-004 (server training rounds per tenant), AILEARN-001 (correction capture), AIP-020 (model registry table)

## Context

A training round from AILEARN-004 needs, for every reviewed nucleus, its pooled embedding, the typer's log-probabilities at each served view count and the reviewed class. AILEARN-001 already turns review decisions into training examples, but nothing on the server keeps the expensive part, the pooled features. They can live in a database table or as files beside the rounds, and labels can be stored with them or joined later.

## Options considered

1. A table of pooled features per nucleus. Queries are easy, but the vectors are blobs, another agent is adding a migration tonight, and the rounds already live as files.
2. One `.npz` file per slide under `tenants/<tenant>/typer-features/<typer>/<base_version>/<slide>.npz` with nucleus keys, features and typer outputs per view count, labels stored in the same file.
3. The same files without labels, which are joined from the current training examples each time a round is assembled.

## Decision

Option 3. `parfocal_ml.reviewed_features.collect` calls a caller-supplied pooler only for nuclei of a slide that are not stored yet, skips rejected ones, and writes the merged file through a draft that replaces the old one. `assemble` joins the stored rows with the current decisions into the `ReviewedRows` that `run_round` takes. A nucleus is `task:kind:number` on its slide. When reviewers give it different final classes, or one rejects it, it is left out and counted as conflicted, and a class the caller's index does not know is left out too. The base version is in the path, because features and typer outputs of one typer version must not train a round on another.

## Consequences

- No migration, and the layout maps onto R2 keys without change like the rounds do.
- A changed or reopened decision relabels a nucleus without pooling it again. A reshaped outline is pooled again since ADR 0323 (the server pools reviewed nuclei like the browser).
- Python has no SAM pooling yet, only the browser does (AILEARN-003 and AILEARN-008). The tests use a seeded fake pooler, and a job that runs the real pooler on Modal is follow-up work.
