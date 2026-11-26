# Roadmap

Milestone gates are defined in [BACKLOG.md](../BACKLOG.md#milestones). Status is `Not started`, `In progress` or `Done`. A "Started" date set before 2026-11-09 stands. The ones added that day are the day of the first tick in the epics the gate names, and for MA the day of its record. M3, M4 and M5 had every gate task ticked by 2026-11-24, found at that day's consolidation, and no target date is set. The owner chose decision 83b (no date, keep building the whole backlog) on 2026-11-13, with the thesis hand-in expected around April or May 2027. This page holds no count. `python3 scripts/board.py counts` prints tasks and ticks per milestone gate and per epic.

| Milestone | Status | Started | Done | Notes |
|---|---|---|---|---|
| M0 Stack decided | In progress | 2026-10-06 | | Open: STACK-031 (model licensing policy, on hold) and the last STACK task the board lists |
| M1 Walking skeleton | In progress | 2026-10-08 | | SKEL-001 (production environment exists) is done and the app is deployed at app.parfocal.eu by hand. SKEL-009 (CI deploys main to production) is on hold by decision 150, and SKEL-002 (log in through the IdP) is open |
| M2 Viewer parity | In progress | 2026-10-18 | | Every POC format reads natively and the custom WebGPU route is finished (VIEW-073). Open are TILES-002 (a CDN in front of slide storage), VIEW-053 (touch tap values on real hardware) and the hardware checks that wait for the owner at the Mac |
| MA Annotation path | In progress | 2026-11-04 | | Added by [ADR 0237](../adr/0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer). Its gate is the task list in that record, and only PILOT-005 (moderated usability study, second round) is open |
| M3 Review loop | Done | 2026-10-17 | by 2026-11-24 | Every gate task is ticked, and the review loop runs on the deployed app with real model results |
| M4 AI runs and visualization | Done | 2026-10-18 | by 2026-11-24 | Every gate task is ticked, the tumor map epic included. Whole slide runs wait for a free L4 (PROTO-168) |
| M5 Collaboration and evaluation | Done | 2026-10-14 | by 2026-11-24 | Every gate task is ticked, remote sources included |
| M6 Pilot ready | In progress | 2026-10-14 | | Security controls, the guided tour and the round 5 study with its study only role are built, and the remote join walk is open (EXP-020). Backups, observability, alerting and production readiness are on hold by the owner's answers, and the pilot study rounds are open |
