# 0319. Training rounds start from the typer and roll back by a pointer

- Date: 2026-11-15
- Status: Accepted
- Deciders: Claude, waiting for the owner
- Backlog: AILEARN-004 (server training rounds per tenant), AILEARN-005 (recalibration after each round), MLEVAL-006 (promotion gate), AIP-020 (model registry table)

## Context

AILEARN-004 (server training rounds per tenant) fine-tunes the typer head on a tenant's reviewed examples, keeps every round as a version and serves the latest promoted one. A round can start from the pretrained typer or from the previous round, and it can be stored in a database table or as files beside the slides. ADR 0315 (a round is recalibrated on held-out slides before promotion) already decides how a round gets its temperature and bands.

## Options considered

1. Start each round from the previous round. Learning accumulates, but a bad round poisons every later one and rollback no longer gives a clean model.
2. Start each round from the pretrained typer on all reviewed training-side examples. Each round stands alone, so rolling back to any version is safe.
3. Store rounds in a new table now. It fits the registry, but AIP-020 (model registry table) is writing that table tonight and the head weights are blobs that belong in object storage anyway.
4. Store each round as a folder `tenants/<tenant>/typer-rounds/<typer>/<version>/` with `head.npz` and `round.json`, plus a `latest.json` pointer with its history. The layout maps onto R2 keys without change.

## Decision

Options 2 and 4. `parfocal_ml.training_rounds.run_round` trains `train_head` with the typer's log-probabilities as its offset on training-side slides only, recalibrates every served view count with `recalibrate` and `promote`, and gates the round on the measuring half of the held-out slides. The round is promoted only when every ECE is at most 0.05 and its accuracy is not below the currently served model's, the typer itself when nothing is served. A refused round is stored with its reasons and never served. Versions are `<base>-round-<n>`, numbers are never reused, and `roll_back` moves only the pointer, to the previous pointer or to a named promoted round of the same tenant.

## Consequences

- No migration. Once AIP-020 lands, a round row in the registry can point at the folder, and MLEVAL-006 (promotion gate) can replace the two gate rules with its per-task thresholds.
- The server does not yet store pooled features for reviewed nuclei, so the caller passes features and typer outputs in. Wiring a job that collects them is follow-up work.
- Every round retrains on all reviewed examples, which costs more as the tenant grows. The tests train on 1,800 nuclei on CPU in under a second per round, and larger tenants are not measured yet.
