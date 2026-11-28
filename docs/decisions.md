# Decisions waiting for the owner

Last updated: 2026-11-28

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

- **Approve or cancel the load test run** (TEST-010, load test tooling). GitHub Actions run 45503594810 from v0.51.0 waits for your approval in the production environment. It runs the API and tile scenarios at 2 users for 60 s with a read-only token, about 0.002 dollars. Recommended: approve it, in GitHub, Actions, that run, Review deployments.
- **Delete the empty lifecycle drill bucket** (OPS-009, storage lifecycle and cost controls). You said yes on 2026-11-26. An agent deleted its two test objects, but the hook against destructive agent actions refuses bucket deletes, so run this yourself from `apps/edge`: `pnpm exec wrangler r2 bucket delete parfocal-drill-lifecycle --jurisdiction eu`. It is free, cannot be undone, and an empty bucket costs nothing meanwhile.
- **Make an R2 key for the study backup** (EXP-022, study recordings backed up to R2). In the Cloudflare dashboard, R2, Manage API tokens, create a token with Object Read and Write on the bucket `parfocal-prod` only, then put `STUDY_BACKUP_ACCESS_KEY_ID`, `STUDY_BACKUP_SECRET_ACCESS_KEY`, `STUDY_BACKUP_BUCKET=parfocal-prod` and `STUDY_BACKUP_ENDPOINT=https://<account>.r2.cloudflarestorage.com` in the Modal secret `parfocal-api-keys` (not `parfocal-api-config`, which bootstrap rewrites). It costs nothing until a backup writes, then a few cents a month, and must leave `parfocal-dev-eu` and its key alone. An agent then runs the first backup and logs its size.

## Later

- **Production for the first real user.** Say when, and the lead books the deploy session.

## Open questions

### 183. Whether new models may use non-commercial weights

Fable's model line-up of 2026-11-28 found that every model already wired (PathoSAM, HoVer-NeXt with PanNuke weights, the CAMELYON tumor model) carries non-commercial or unclear weights, and the best candidates for tissue type regions and a second typer do too. Parfocal is a thesis project with no paying customer yet. PROTO-217 (tissue type and scan quality models) and PROTO-218 (a second cell typer) wait for this.

- **A. Accept non-commercial weights while Parfocal has no paying customer**, record each licence in the model registry, and revisit before the first paid use.
- B. Only permissive weights such as Apache-2.0 from now on, which leaves few tissue type models and no better typer.
- Other.

Your choice:

### 184. Whether a whole slide cell run is the default or an area is

A full PathoSAM + HoVer-NeXt run over one slide costs about 2 to 2.40 dollars on an L4 by projection, so the $30 a month allows about ten. PROTO-214 (a cell run can cover only tumor areas or a drawn area) builds the area choice.

- **A. Run a model defaults to the tumor areas or a drawn area, and the whole slide stays a choice** with its projected cost shown.
- B. Whole slide by default, with the cost shown.
- Other.

Your choice:

### 185. May one full whole slide nucleus run spend about 2.40 dollars of the December budget

PROTO-215 (one full whole slide nucleus run measured on an L4) replaces the projected time and cost with a real one on test_001.

- **A. Yes, one run in December**, logged with its cost.
- B. No, keep the projection.
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
