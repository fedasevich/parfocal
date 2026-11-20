# Decisions waiting for the owner

Last updated: 2026-11-20

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

- **Delete the US bucket `parfocal-dev`**, now. OPS-037 (nothing reads the US bucket) is merged and main CI read every fixture from the EU bucket on 2026-11-20. Every reader now uses `parfocal-dev-eu`, which holds every object the US bucket had. The delete cannot be undone. It frees 38.1 GB in 3,489 objects, about $0.57 a month, and costs nothing, since R2 deletes are free. Three steps, about ten minutes plus the dashboard's background emptying:
  1. Remove the bucket lock, because a locked bucket cannot be emptied: `bash infra/tofu/tofu.sh dev apply -target=cloudflare_r2_bucket_lock.retired_us`. The plan shows 1 to destroy.
  2. In the Cloudflare dashboard open R2, `parfocal-dev`, Settings, and select Empty under Empty Bucket. Wait until it shows the bucket empty.
  3. `bash infra/tofu/tofu.sh dev apply`. The plan shows 0 to add, 0 to change, 4 to destroy: the bucket `parfocal-dev`, its CORS rule, its lifecycle rules and the US read-only token `parfocal-fixtures-read`. Then delete the two GitHub secrets that held that token: `gh secret delete PARFOCAL_FIXTURES_R2_ACCESS_KEY_ID` and `gh secret delete PARFOCAL_FIXTURES_R2_SECRET_ACCESS_KEY`. If you like, also delete the account token "parfocal-dev local" in Cloudflare, Manage account, Account API tokens, since it reaches only that bucket.

## Later

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
