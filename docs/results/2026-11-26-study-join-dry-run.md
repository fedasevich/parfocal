# Result: a deployed dry run from one join link to the thank you page reached 6 of 7 steps

- Date: 2026-11-26
- Backlog: EXP-020 (a prepared participant joins a remote moderated session by one link)
- Kind: deployed dry run
- Environment: app.parfocal.eu, the deployed development app
- Data: one participant project, code P-7QQZ, fictional names only, no PHI

## Method

`scripts/study-join-dry-run.sh` ran `apps/web/smoke/study-join.spec.ts`, which signed in as the smoke account, pressed Make a join link in the study console, opened the link in a fresh browser context with no sign in, walked `/study` through every round 5 task, answered the last questions and reached the thank you page. The console then showed the participant as finished, the session was ticked Dry run, and the project was removed from the console.

## Results

| Step | Outcome | Time |
| --- | --- | --- |
| make the link | reached | 16 s |
| open the link | reached | 1 s |
| open-case | reached | 7 s |
| patient-details | reached | 7 s |
| unsure-place | reached | 7 s |
| check-cells | reached | 9 s |
| change-type | failed: Error: expect(locator).toHaveText(expected) failed | 23 s |
