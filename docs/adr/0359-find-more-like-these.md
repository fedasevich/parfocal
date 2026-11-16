# 0359. Find more like these is a no-go on PathoSAM tokens, and waits for a typed fixture or a concept model

- Date: 2026-11-16
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: AISEG-014 (find more like these, exemplar prompting). Refs POC doc 20 section 2.9 (text and exemplar prompts). Builds on [ADR 0346](0346-server-embeddings-are-float16-tiles-in-the-slide-bucket.md) (server embeddings are float16 tiles) and [ADR 0261](0261-auto-region-pass.md) (the auto region pass)

## Context

POC doc 20 section 2.9 proposes a gesture: select a few cells and find similar objects in the view. SAM 3 concept prompts do this but are gated, and a 2026 study found they depend heavily on exemplars in pathology. The cheapest version reuses the PathoSAM embedding the click loop already has: pool tokens under the exemplars, find peaks of the cosine map and prompt the decoder there. The spike measured that on TNBC in the [result](../results/2026-11-16-exemplar-search-on-tnbc.md).

## Criteria, written before the run

Go only if all of these hold on the TNBC images not used to pick the threshold.

1. Seeds. Peaks of the exemplar similarity map hit at least 90% of the nuclei, with at most 20% of peaks on background or on a nucleus already hit.
2. End to end. Decoding at those peaks scores PQ within 0.05 of prompting at every true centroid through the same Python decode path.
3. Selectivity. With three exemplars from the largest third of nuclei, the token similarity separates the other large nuclei from the smallest third with a mean AUROC of at least 0.75, and beats the mean colour of the exemplars as a ranking.

If 1 and 2 hold and 3 fails, the gesture finds nuclei but not "these" nuclei, which the auto region tool already does, so it is a no-go.

## Options considered

| Option | Feasible now | Quality measured |
|---|---|---|
| 1. Cosine peaks on PathoSAM tokens, decoder at each peak | Yes, no new model | Seeds hit 85.1%, 70% wrong seeds, PQ 0.754 against 0.841 for the centroid control |
| 2. Run the auto region tool, then rank its nuclei by pooled token cosine to the exemplars | Yes, no new model | Detection is the shipped PQ 0.796. Ranking only on a size proxy, 0.934 AUROC, confounded by token mixing |
| 3. SAM 3 concept prompts with image exemplars | Weights gated behind a sign-in, too large for the browser | Unmeasured |
| 4. A pathology foundation model (UNI2, Virchow2) for the ranking in option 2 | Server only, gated weights | Unmeasured |

## Decision

No-go. Criteria 1 and 2 fail, and criterion 3 passes only on a proxy that size alone may explain. Nothing ships, and the bench `pnpm --filter @parfocal/ml bench:exemplar-search` stays for a later run.

If the gesture comes back, it should be option 2: the auto region tool finds the nuclei and exemplars only rank or filter them, because PathoSAM tokens separate nucleus from background at an AUROC of about 0.54 and cannot seed a search. That needs a typed fixture to show it ranks cell kinds, not size.

## Consequences

- The region pass and the group and comment model need no change.
- A typed fixture, such as PanNuke, is the next measurement. TODO: decided in `docs/decisions.md`.
- SAM 3 and foundation-model features stay unmeasured until a task can fetch gated weights.
