# 0086. Node staging is a pure function, the largest area by its best size leads, and a node settles only when no other area can outrank it

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: REVIEW-003, REVIEW-020, CASE-013, MEAS-006, AINUC-012

## Context

A sentinel node is staged by its largest metastatic deposit ([ADR 0012](0012-ux-round-2-prototype-revisions.md), POC [doc 36](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/36-sentinel-node-areas.md)). Over 2 mm is a macrometastasis (pN1a(sn)), over 0.2 mm or more than 200 cells a micrometastasis (pN1mi(sn)), and otherwise isolated tumor cells (pN0(i+)(sn)). The areas come from the tumor map with an AI size that came within 10% of a pathologist's outline on one slide. The doctor confirms or rules out each area, may measure it (MEAS-006), and for a cluster at or under 0.2 mm the tumor cell count decides. POC [doc 33](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/33-showing-confidence-to-doctors.md) gives the count range: from the sum of tumor probabilities over the cells called tumor, up to the count of tumor calls plus the sum of tumor probabilities over the other cells. On 32 PanNuke regions its firm answers were never on the wrong side of a cutoff.

The mock's `stage()` takes the first area in AI size order that is not ruled out, and settles once that area is confirmed, measured and, when a count is needed, its count range is under 200. It then marks every smaller area as unable to change the category.

## Options considered

1. Copy the mock. Simple, but a measurement never changes which area leads, a smaller unmeasured area whose ±10% range reaches past the lead's measurement is still called unable to change the category, and a count range wholly above 200 never settles.
2. Lead by the best size (the measurement when there is one, else the AI size), settle only when no other area that is not ruled out could reach a higher category with the top of its size and count ranges, and treat a count as firm when its range cannot cross 200 in either direction.

## Decision

Option 2, as `parfocal_common.node_staging.stage_node`. It is a pure function of the areas, so the API, the report and the viewer can share it once the areas, measurements and nuclei are stored.

- The lead is the largest area that is not ruled out, by measured size, else AI size. An unsure area is not ruled out.
- An unmeasured size is the AI size with a ±10% range. A measured size has no range.
- A count is needed when the lead's size is at or under 0.2 mm. Reviewed cells count as certain, confirmed or not. A count is firm when its high end is at most 200 or its low end is over 200.
- The state is `open` while the lead is not confirmed tumor, `so-far` once it is, and `settled` once it is also measured, its count is firm when one is needed, and no other area could reach a higher category. With no areas left after ruling out, the stage is pN0(sn) and settled. With no areas at all it is pN0(sn) so far, because nothing was confirmed.
- Each area reports the highest category its ranges allow and whether it can still change the node's category.

The doc 33 evidence is from PanNuke regions and HoVer-NeXt, and only aggregate numbers survive in the POC, so the property that firm answers are never wrong cannot be re-run here yet. It moves to REVIEW-020 (firm staging answers on a validation set), which needs AINUC-012's per-area counts and labelled clusters.

## Consequences

- REVIEW-003 ships the function with unit tests for each boundary, the lead taking over when the largest is ruled out, a measurement changing the lead, the count rule and the rival area rule. The HTTP endpoint comes with the stored areas, since the function has nothing to read until then.
- REVIEW-020 is new. CASE-013 and MEAS-006 read the state and the per-area flags.
- The AJCC wording and stages must still be confirmed by a pathologist against local practice before anyone relies on them, as doc 36 says. TODO: ask the pilot pathologist.
