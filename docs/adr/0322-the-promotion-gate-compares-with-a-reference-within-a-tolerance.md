# 0322. The promotion gate compares with a reference within a tolerance

- Date: 2026-11-15
- Status: Accepted
- Deciders: Claude, waiting for the owner
- Backlog: MLEVAL-006 (promotion gate), AILEARN-004 (server training rounds per tenant), AIP-020 (model registry table)

## Context

MLEVAL-006 (promotion gate) promotes a model version to the validated status only when it meets thresholds per task, and stores the evaluation report in the registry. ADR 0319 (training rounds start from the typer and roll back by a pointer) left two stand-in rules in `training_rounds.run_round`, an ECE cap of 0.05 and accuracy not below the served model. The gate needs thresholds for the typer, the detector, the interactive encoder and the tumor map, and the only numbers we have are the reference measurements in the MLEVAL result files.

## Options considered

1. Absolute floors per task, such as accuracy at least 0.83. They are simple, but they only hold on the benchmark they were measured on, and a tenant round measured on that tenant's own slides could never be compared with them.
2. A candidate may fall below a reference measured on the same data by at most a tolerance, plus absolute caps where a cap is the real rule, such as ECE. When no reference is given, the recorded baseline from the result file stands in.
3. Leave thresholds to the operator per promotion. It is flexible, but nothing would stop a degraded model being promoted with loose numbers.

## Decision

Option 2, in `parfocal_common.promotion_gate` so the API and the ML worker share it. The typer may not drop in accuracy below its reference and its worst ECE must be at most 0.05, the baseline being accuracy 0.8297 on PanNuke fold 3 ([typing calibration result](../results/2026-10-18-typing-calibration-reproduction.md)). The detector may drop at most 0.01 in PQ and F1 from pathosam-ais-browser on TNBC, PQ 0.8235 and F1 0.9489 ([geometric scorer result](../results/2026-10-18-geometric-scorer-reproduction.md)). The interactive encoder may drop at most 0.01 in mean IoU for the realistic click, the exact box, the loose box and three clicks on TNBC ([interactive protocol result](../results/2026-11-06-interactive-protocol-on-tnbc.md)), which is the tolerance that result used to call a reproduction equal. The tumor map is refused until MLEVAL-005 (tumor map evaluation) measures it. A missing metric is a refusal.

`POST /api/platform/model-registry/{name}/{version}/promotion` runs the gate over every gated task of a candidate, stores the report in the new `registered_models.evaluation` column (migration 0115) whether it passes or not, and moves the status to validated only on a pass. Tenant training rounds use the same gate with the served model as the reference and keep their report in `round.json`, because a row per tenant round in the platform table would collide on name and version and be listed to every tenant.

## Consequences

- Promoting needs a measured report from a run on the benchmark. The endpoint takes the numbers, it does not run the evaluation itself.
- A tolerance of 0.01 lets a slightly worse model pass when it is cheaper or faster. A stricter rule is one constant to change.
- TODO: add the tumor map threshold when MLEVAL-005 records its size error and FROC on CAMELYON16 test slides.
