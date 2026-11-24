# The guided tour plays every chapter on the deployed app

- Date: 2026-11-24
- Backlog: PILOT-014 (the guided tour covers every function of the app, per role), on the engine of PILOT-013 (a guided tour over the real app that switches role accounts)
- Version: v0.51.0 on app.parfocal.eu, with the role switch on through the Modal secret `parfocal-api-tour` ([ADR 0437](../adr/0437-the-guided-tour-switches-to-role-accounts-on-the-dev-app.md))
- How: `node e2e/deployed-tour.ts --state ~/.config/parfocal/lead-session.json` from `apps/web`, signed in as agent-walk with `scripts/agent_session.py`, active workspace cvut-biomedical. GPU steps are skipped, so no GPU call was made.

## Result

Every chapter reached its end, every seeded name resolved exactly and every step ringed its control. The full run played chapters 1 to 14 (95 steps) and then hit a 30 s timeout loading the home page before chapter 15. Chapters 15 and 16 then passed on their own.

| Chapter | Steps ringed | Accounts |
|---|---|---|
| 1 Upload and import | 6 | Researcher Role |
| 2 Review as reviewer A | 6 | Reviewer A Role |
| 3 Projects and their settings | 6 | Researcher Role, Viewer |
| 4 The viewer and its tabs | 9 | Researcher Role, Viewer |
| 5 Annotate as an expert | 6 | Annotator, Viewer |
| 6 Create a review task | 8 | Researcher Role |
| 7 Review as reviewer B and as a viewer | 6 | Reviewer B, Reviewer A Role, Viewer, Agent Tester |
| 8 The queue and adjudication | 8 | Researcher Role, Adjudicator, Reviewer A Role |
| 9 Sign off, evaluation and dataset | 7 | Researcher Role, Agent Tester |
| 10 Cases and reports | 7 | Agent Tester, Researcher Role |
| 11 Jobs and model runs | 5 | Researcher Role, Agent Tester |
| 12 Search | 6 | Researcher Role, Viewer |
| 13 Notifications and comments | 7 | Adjudicator, Agent Tester, Reviewer A Role, Researcher Role, Reviewer B |
| 14 Team and settings | 8 | Researcher Role, Reviewer A Role |
| 15 Admin | 11 | Agent Tester (the starting admin), Researcher Role and Reviewer B on the refused page |
| 16 The participant study | 4 | Agent Tester |

Seven accounts appear: Agent Tester (the admin who started the tour) and the six role accounts. Two steps of chapter 16 rang a fallback anchor (the study screen instead of the task card), which the script allows. Eight admin steps ring the page's main area rather than one control.

## What went wrong first

- The first full run on v0.51.0 printed MISSING route=fallback for most steps because the account's active workspace was cvut-imaging, where the seeded project names differ. The script now makes cvut-biomedical active first (commit 04eb0d5f).
- A rerun then passed with no chapter played, because the script read the tour menu before its buttons rendered. It now waits for the first Play button and refuses an empty list (commit 4f933c97).
