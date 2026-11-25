# Decisions waiting for the owner

Last updated: 2026-11-25

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

- **Delete the US bucket `parfocal-dev`**, now. OPS-037 (nothing reads the US bucket) is merged and main CI read every fixture from the EU bucket on 2026-11-20. Every reader now uses `parfocal-dev-eu`, which holds every object the US bucket had. The delete cannot be undone. It frees 38.1 GB in 3,489 objects, about $0.57 a month, and costs nothing, since R2 deletes are free. Three steps, about ten minutes plus the dashboard's background emptying:
  1. Remove the bucket lock, because a locked bucket cannot be emptied: `bash infra/tofu/tofu.sh dev apply -target=cloudflare_r2_bucket_lock.retired_us`. The plan shows 1 to destroy.
  2. In the Cloudflare dashboard open R2, `parfocal-dev`, Settings, and select Empty under Empty Bucket. Wait until it shows the bucket empty.
  3. `bash infra/tofu/tofu.sh dev apply`. The plan shows 0 to add, 0 to change, 4 to destroy: the bucket `parfocal-dev`, its CORS rule, its lifecycle rules and the US read-only token `parfocal-fixtures-read`. Then delete the two GitHub secrets that held that token: `gh secret delete PARFOCAL_FIXTURES_R2_ACCESS_KEY_ID` and `gh secret delete PARFOCAL_FIXTURES_R2_SECRET_ACCESS_KEY`. If you like, also delete the account token "parfocal-dev local" in Cloudflare, Manage account, Account API tokens, since it reaches only that bucket.

- **Modal is almost out of its November credit.** On 2026-11-24 the live cost report showed 29.22 dollars of the 30 dollar monthly credit spent, and production Modal at 28.39 dollars against its 23.50 dollar budget. Recommended: no GPU work in production until 1 December, which agents follow from now until you answer. The other choice is to raise the production Modal budget, which would take the month past the 30 dollars. Reply "pause until December" or name a new budget.
- **Approve or cancel the load test run** (TEST-010, load test tooling). GitHub Actions run 45503594810 from v0.51.0 waits for your approval in the production environment. It runs the API and tile scenarios at 2 users for 60 s with a read-only token, about 0.002 dollars. Recommended: approve it, in GitHub, Actions, that run, Review deployments.
- **Delete the lifecycle drill bucket after its check** (OPS-009, storage lifecycle and cost controls). An agent created the EU bucket `parfocal-drill-lifecycle` outside OpenTofu for the R2 tiering drill. From 2026-11-25 23:00 UTC an agent checks that its two objects moved to Infrequent Access. Recommended: let the agent delete the bucket and its two test objects right after that check. Reply "delete after the check" or "keep".

## Later

- **Production for the first real user.** Say when, and the lead books the deploy session.

## Open questions

None open. Decisions 175, 176, 177, 178, 179, 180 and 181 are answered and applied, see decisions-answered.md.

## The review column, what each task waits for

Last checked 2026-11-24.

Waits for you:

- PROTO-168 (a queued whole slide run starts within its promised time). Its deployed check on 2026-11-24 queued 29.6 minutes for a free L4 against a 19 minute promise. Your answer to decision 181 made OPS-042 (GPU pools take any GPU big enough in any region), and PROTO-168 waits for it. Nothing from you.
- TEST-010 (load test tooling) and TEST-056 (a walkthrough artifact of the whole deployed app). Agents finish them, nothing from you.
- OPS-009 (storage lifecycle and cost controls). The agent token reads account analytics since 2026-11-19, so an agent makes the first live cost report. Nothing from you.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Record input traces on your trackpad at `/spikes/input-traces` in the local dev app, about two minutes.
- VIEW-052 (hidden tab check in headed Chrome). Keep the Mac unlocked and awake for about five minutes while an agent runs the check.

On hold by your answers: OPS-005 (continuous deployment) and SKEL-009 (CI deploys main) by decision 150, OPS-006 (observability) and OPS-007 (alerting) by decision 149, OPS-008 (backups) and SEC-014 (backup restore tests) by decision 152, OPS-014 (production for the first real user) and PILOT-004 (pilot data onboarding) until you have a real pilot sample.
