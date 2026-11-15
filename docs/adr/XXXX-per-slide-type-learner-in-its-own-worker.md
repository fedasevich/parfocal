# XXXX. The per-slide type learner reads the typer's answer as features and runs in its own worker

- Date: 2026-11-15
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: AILEARN-002 (browser per-slide learner). Builds on [ADR 0253](0253-sam-inference-worker.md) (the SAM inference worker)

## Context

POC doc 22 (learning from corrections, two ways) measured a small softmax regression in the page that learns from each reviewed nucleus. On the images being corrected it took balanced typing accuracy from about 51% to about 65% after 200 corrections, where a retrained server model needs minutes. Doc 22 tried two ways to give the learner the typer's starting point. Adding the typer's log probabilities to the learner's scores as a prior scored worse, because the typer is overconfident and a learner that must overturn a log probability of -9 barely moves. Appending the four log probabilities to the pooled embedding features scored best.

## Options considered

1. Add the typer's log probabilities as a fixed prior. With no corrections it is the typer, but doc 22 found it learns little.
2. Append the typer's log probabilities to the pooled PathoSAM features and let the learner weigh them. Doc 22's best measured variant.
3. Train in the SAM worker. One worker fewer, but a correction would wait behind an encode of several seconds.
4. Train in its own small worker. Training takes milliseconds and never waits for the encoder. The SAM worker only pools the held embedding under an outline and returns the vector.

## Decision

Options 2 and 4. The learner is a class-balanced softmax regression over standardized features with Adam and L2, warm-started after each correction, in `packages/viewer-engine/src/learner/`. Its input is the PathoSAM embedding averaged under the nucleus and over a two-cell ring around it, followed by the typer's log probabilities in the slide's class order, uniform when no typer answered. A correction to the same shape replaces the earlier one. The examples, not the weights, are saved with the slide's annotation document as a versioned record with 16-bit per-dimension quantized features, and the learner retrains from them when the slide opens. A record with another version, variant or feature size is discarded rather than read. Labels are stored by class key, so a changed class list keeps what still matches. A learner prediction never retypes a shape a person reviewed.

## Consequences

The protocol from doc 22 is shared code, so the node test runs it on a seeded synthetic slide and `pnpm --filter @parfocal/viewer-engine bench:type-learner DIR` runs it on the POC's PanNuke feature files. The synthetic test checks the mechanics only. On the real features the learner gained 14.0 points over the typer after 200 corrections ([result](../results/2026-11-15-per-slide-type-learner-same-images.md), the per-slide learner on the same images). The record is written in the own-format and GeoJSON exports today. Keeping it on the server with the slide's saved annotations needs an API change and is left to a follow-up.
