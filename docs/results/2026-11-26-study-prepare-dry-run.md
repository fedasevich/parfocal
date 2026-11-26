# Result: a deployed dry run from Prepare to the thank you page reached 5 of 6 steps

- Date: 2026-11-26
- Backlog: EXP-018 (the moderator prepares a participant project from the console)
- Kind: deployed dry run
- Environment: app.parfocal.eu, the deployed development app
- Data: one participant project, code P-JNTJ, fictional names only, no PHI

## Method

`scripts/study-prepare-dry-run.sh` ran `apps/web/smoke/study-prepare.spec.ts`, which signed in as the smoke account, read the code the participant page made, pressed Prepare the participant in the study console, switched to the study workspace when the console offered it, walked `/study` through every round 5 task answering each SEQ with 5, answered the last questions and reached the thank you page. It then ticked Dry run on the session in the console results, so the round does not count it, and removed the project from the console.

## Results

| Step | Outcome | Time |
| --- | --- | --- |
| prepare | reached | 23 s |
| open-case | reached | 7 s |
| patient-details | reached | 7 s |
| unsure-place | reached | 7 s |
| check-cells | reached | 8 s |
| change-type | failed: Error: expect(locator).toHaveText(expected) failed | 23 s |
