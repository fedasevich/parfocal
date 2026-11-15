# 0315. A training round is recalibrated on held-out slides before it can be promoted

- Date: 2026-11-15
- Status: Accepted
- Deciders: Claude, waiting for the owner
- Backlog: AILEARN-005 (recalibration after each round), AILEARN-004 (server training rounds per tenant), AILEARN-006 (held-out validation split from recent labels), AINUC-006 (calibration)

## Context

AINUC-006 (calibration) fits one temperature per typer version and view count on one PanNuke fold and measures it on another. A training round in AILEARN-004 (server training rounds per tenant) makes a new typer version from a tenant's reviewed examples, and its confidence can differ a lot from the version it started from. A [result file](../results/2026-11-15-recalibration-after-a-round.md) on two stand-in rounds measures an ECE of 0.077 and 0.089 with the old temperature, 0.059 and 0.100 with a temperature fitted on the round's own training examples and 0.015 and 0.019 with one fitted on held-out slides. A round has only the tenant's held-out slides from AILEARN-006 (held-out validation split) to fit and measure on.

## Options considered

1. Keep the old version's temperature. Nothing to fit, but the measured ECE stays over 0.05.
2. Fit on the round's training examples. Plenty of nuclei, but the head has seen them, and the measured ECE stays over 0.05 on both stand-ins.
3. Fit and measure on the whole held-out side. Uses every held-out nucleus for the fit, but then the reported ECE and band accuracies are measured on the nuclei the temperature was fitted on.
4. Split the held-out slides in two by a hash of the slide key, fit on one half and measure ECE and bands on the other.

## Decision

Option 4. `parfocal_ml.round_calibration.recalibrate` refuses outputs on any slide the AILEARN-006 split puts on the training side, puts each held-out slide on the fit or the measuring half by the first 8 bytes of a SHA-256 of `parfocal.round-calibration:` and the slide key, and needs at least 5 slides and 500 nuclei on each half. A slide keeps its half across rounds, and all of a slide's nuclei stay on one half. `promote` takes every view count the round will serve and refuses a round that lacks a temperature and the four bands for any of them. The new rows are keyed by the round's version, so the rows of earlier versions never change and a running review keeps its stored order as [ADR 0117](0117-review-order-is-stored-per-task-slide.md) (least sure first order stored per task slide) says.

## Consequences

- A small tenant cannot promote a round until it has reviewed enough held-out slides. The minimums are a starting rule and can be tuned once real rounds exist.
- Half of the held-out nuclei do not inform the fit. With hundreds of slides that costs little, because the temperature is one number.
- Storage of the rows waits on AILEARN-004 and the registry tables. Until then `catalogue_row` returns them in the code catalogue's rounding.
