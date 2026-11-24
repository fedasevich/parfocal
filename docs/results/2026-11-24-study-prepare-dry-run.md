# Result: a deployed dry run from Prepare to the thank you page reached 14 of 14 steps

- Date: 2026-11-24
- Backlog: EXP-018 (the moderator prepares a participant project from the console)
- Kind: deployed dry run
- Environment: app.parfocal.eu, the deployed development app
- Data: one participant project, code P-AXAE, fictional names only, no PHI

## Method

`scripts/study-prepare-dry-run.sh` ran `apps/web/smoke/study-prepare.spec.ts`, which signed in as the smoke account, read the code the participant page made, pressed Prepare the participant in the study console, switched to the study workspace when the console offered it, walked `/study` through every round 5 task answering each SEQ with 5, answered the last questions and reached the thank you page. It then removed the project from the console.

## Results

| Step | Outcome | Time |
| --- | --- | --- |
| prepare | reached | 29 s |
| open-case | reached | 7 s |
| patient-details | reached | 7 s |
| unsure-place | reached | 7 s |
| check-cells | reached | 9 s |
| change-type | reached | 10 s |
| whole-slide | reached | 7 s |
| compare | reached | 7 s |
| add-scans | reached | 8 s |
| sign-out | reached | 14 s |
| queue-decision | reached | 8 s |
| annotate-area | reached | 8 s |
| thank you | reached | 1 s |
| remove | reached | 1 s |

## Notes

- The earlier runs of the same day (codes P-UQMF, P-XMPS, P-LD69 and P-XZZP) stopped at the cell card, the SEQ race and the required opinion question, and the walk was fixed after each one. Their projects were removed.
- The sessions of all five codes were uploaded with the Dry run box unticked. They were ticked afterward in the console results, and the sessions list now returns `dry_run` true for each. The spec now ticks the box itself in a step before the remove step, which no deployed run has exercised yet because the four runs for this task were used up.
