# Decisions waiting for the owner

Last updated: 2026-11-20

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

None. All five steps of 2026-11-19 are done and checked.

## Later

- **The US bucket `parfocal-dev`.** It still serves CI's test fixtures and local dev, so deleting it now would break CI. OPS-037 (nothing reads the US bucket) moves the readers to the EU bucket first, then asks you for one delete. It saves about $0.57 a month.
- **The Zitadel login user** (decision 95, option A). A short session with you, about 15 minutes, when you want the app's own sign-in screens instead of the hosted Zitadel page.
- **Two Kaggle downloads** (decision 131), CryoNuSeg and Lizard, when convenient.
- **Production for the first real user.** Say when, and the lead books the deploy session.

## Open questions

None right now.

## The review column, what each task waits for

Last checked 2026-11-19.

Waits for you:

- OPS-035 (agents get a signed-in session on the dev app), OPS-029 (a queued job starts a worker in the deployed app), TEST-010 (load test tooling), TEST-020 (showcase seed over every feature), TEST-046 (a ready demo workflow on the dev app), TEST-047 (demo seed with real model results), PROTO-025 (real data on Home, My work and the wizards) and INGEST-032 (every deployed slide has a thumbnail). All of them wait for the reseed of 2026-11-19, after which an agent walks the dev app with its test account. Nothing from you.
- OPS-009 (storage lifecycle and cost controls). The agent token reads account analytics since 2026-11-19, so an agent makes the first live cost report. Nothing from you.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Record input traces on your trackpad at `/spikes/input-traces` in the local dev app, about two minutes.
- VIEW-052 (hidden tab check in headed Chrome). Keep the Mac unlocked and awake for about five minutes while an agent runs the check.

On hold by your answers: OPS-005 (continuous deployment) and SKEL-009 (CI deploys main) by decision 150, OPS-006 (observability) and OPS-007 (alerting) by decision 149, OPS-008 (backups) and SEC-014 (backup restore tests) by decision 152, OPS-014 (production for the first real user) and PILOT-004 (pilot data onboarding) until you have a real pilot sample.
