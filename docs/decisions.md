# Decisions waiting for the owner

Last updated: 2026-11-25

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

- **Approve or cancel the load test run** (TEST-010, load test tooling). GitHub Actions run 45503594810 from v0.51.0 waits for your approval in the production environment. It runs the API and tile scenarios at 2 users for 60 s with a read-only token, about 0.002 dollars. Recommended: approve it, in GitHub, Actions, that run, Review deployments.
- **Delete the lifecycle drill bucket after its check** (OPS-009, storage lifecycle and cost controls). An agent created the EU bucket `parfocal-drill-lifecycle` outside OpenTofu for the R2 tiering drill. From 2026-11-25 23:00 UTC an agent checks that its two objects moved to Infrequent Access. Recommended: let the agent delete the bucket and its two test objects right after that check. Reply "delete after the check" or "keep".
- **Make an R2 key for the study backup** (EXP-022, study recordings backed up to R2). In the Cloudflare dashboard, R2, Manage API tokens, create a token with Object Read and Write on the bucket `parfocal-prod` only, then put `STUDY_BACKUP_ACCESS_KEY_ID`, `STUDY_BACKUP_SECRET_ACCESS_KEY`, `STUDY_BACKUP_BUCKET=parfocal-prod` and `STUDY_BACKUP_ENDPOINT=https://<account>.r2.cloudflarestorage.com` in the Modal secret `parfocal-api-keys` (not `parfocal-api-config`, which bootstrap rewrites). It costs nothing until a backup writes, then a few cents a month, and must leave `parfocal-dev-eu` and its key alone. An agent then runs the first backup and logs its size.

## Later

- **Production for the first real user.** Say when, and the lead books the deploy session.

## Open questions

### 182. Whether the $5 an hour GPU cap holds per pool or for all pools together

OPS-042 (GPU pools take any GPU big enough in any region) gave every pool cards up to the H100 and kept each pool under $5 an hour at its container cap, as the task asked. Before, all pools together stayed under $5 an hour, so now all pools at full load could reach $20.25 an hour, with only the $30 a month Modal limit above that.

- **A. Keep the cap per pool**, because runs start only on demand and the $30 a month Modal limit still stops the bill.
- B. Shorten the card lists so all pools together stay under $5 an hour again, which makes busy runs wait longer.
- Other.

Your choice:

## The review column, what each task waits for

Last checked 2026-11-24.

Waits for you:

- PROTO-168 (a queued whole slide run starts within its promised time). Its deployed check on 2026-11-24 queued 29.6 minutes for a free L4 against a 19 minute promise. Your answer to decision 181 made OPS-042 (GPU pools take any GPU big enough in any region), and PROTO-168 waits for it. Nothing from you.
- TEST-010 (load test tooling) and TEST-056 (a walkthrough artifact of the whole deployed app). Agents finish them, nothing from you.
- OPS-009 (storage lifecycle and cost controls). The agent token reads account analytics since 2026-11-19, so an agent makes the first live cost report. Nothing from you.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Record input traces on your trackpad at `/spikes/input-traces` in the local dev app, about two minutes.
- VIEW-052 (hidden tab check in headed Chrome). Keep the Mac unlocked and awake for about five minutes while an agent runs the check.

On hold by your answers: OPS-005 (continuous deployment) and SKEL-009 (CI deploys main) by decision 150, OPS-006 (observability) and OPS-007 (alerting) by decision 149, OPS-008 (backups) and SEC-014 (backup restore tests) by decision 152, OPS-014 (production for the first real user) and PILOT-004 (pilot data onboarding) until you have a real pilot sample.
