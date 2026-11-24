# Decisions waiting for the owner

Last updated: 2026-11-22

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

- **Smart select Best warms up before the click** (PROTO-159, round six slips). When Best is picked, the viewer sends one GPU call to warm the box around the view's centre, then a second when the person clicks. Keeping the warm-up makes the first click answer 3 to 4 seconds sooner, but bills two GPU calls when the click lands outside the warmed box. Recommended: keep the warm-up, because the wait is what people notice and each call costs a fraction of a cent. Reply "keep warm-up" or "no warm-up".
- **How the next usability round runs** (EXP-014, the study runs for the participant in one tab, and PILOT-005, the moderated second round). Recommended: moderated, on a browser the lead prepares and signs in to the participant's fresh study project, as round 4 and PILOT-005 planned. It needs no participant accounts and lets you hear them think aloud. The other choice is remote and unmoderated through a link, which reaches more people but needs a sign-in account per participant and loses the think-aloud. Reply with "moderated" or "remote". Until you answer, agents build the moderated way, which the remote way can reuse.
- **When the moderator stops a stuck study task** (PILOT-012, the round 5 protocol). Participants can give up themselves after 20 seconds, but nothing ends a task when someone keeps trying. Recommended: the moderator ends a task after 5 minutes without progress and records it as gave up with the reason "stopped by the moderator", so one stuck task cannot eat the session and the tables count it as a failure. Reply with a number of minutes or "no cut-off".
- **Who may remove a prepared study participant** (EXP-018, the moderator prepares a participant project from the console). Preparing seeds the project into the study workspace with the moderator's own account as its seat, and a moderator new to that workspace joins it as a researcher without admin rights, so after switching to the study workspace they cannot remove the project from there and the dry run prints the command line remove instead. Option A, recommended: keep it so, and prepare and remove from the workspace where the moderator is an admin. Option B: a new seat joins the study workspace with admin rights. Your choice:
- **Where round 5 starts the clock for time to first action** (EXP-019, round 5 measures dead clicks and time to first action as round 4 did). Round 4 never logged when its task card appeared, so round 5 now measures from task start (round 4 `study.js` line 469) to the first click or key the app handles, which is how EXP-019 read round 4's definition on slide 05 of the round 4 deck. Option A, recommended: keep that reading. Option B: measure from when the task card appears, which round 4 cannot be compared with. Your choice:
- **How long study recordings are kept** (EXP-015, study sessions and traces reach the server). Recommended: keep the raw traces and answers until the thesis is defended, then delete the traces and keep only the anonymous tables and notes that went into the thesis. Reply "until the defence" or name another date.
- **Whole slide runs fall back to a bigger GPU when no L4 is free** (PROTO-168, a queued whole slide run starts within its promised time). On 2026-11-23 a 2 tile run waited 18 minutes because Modal had no free L4 GPU in the EU, then worked for 30 s. Letting `detector_best` also take an A10G when no L4 is free would cut such waits, and raises its worst case from about $1.60 to $2.20 an hour of GPU time, still under the $5 Modal cap. Recommended: allow the fallback, because waits like this break a demo or a study session and the cost difference only applies while a run is actually working. Reply "fallback" or "L4 only". Until you answer, runs stay on L4 and the screen now says why they wait.

## The review column, what each task waits for

Last checked 2026-11-19.

Waits for you:

- OPS-035 (agents get a signed-in session on the dev app), OPS-029 (a queued job starts a worker in the deployed app), TEST-010 (load test tooling), TEST-020 (showcase seed over every feature), TEST-046 (a ready demo workflow on the dev app), TEST-047 (demo seed with real model results), PROTO-025 (real data on Home, My work and the wizards) and INGEST-032 (every deployed slide has a thumbnail). All of them wait for the reseed of 2026-11-19, after which an agent walks the dev app with its test account. Nothing from you.
- OPS-009 (storage lifecycle and cost controls). The agent token reads account analytics since 2026-11-19, so an agent makes the first live cost report. Nothing from you.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Record input traces on your trackpad at `/spikes/input-traces` in the local dev app, about two minutes.
- VIEW-052 (hidden tab check in headed Chrome). Keep the Mac unlocked and awake for about five minutes while an agent runs the check.

On hold by your answers: OPS-005 (continuous deployment) and SKEL-009 (CI deploys main) by decision 150, OPS-006 (observability) and OPS-007 (alerting) by decision 149, OPS-008 (backups) and SEC-014 (backup restore tests) by decision 152, OPS-014 (production for the first real user) and PILOT-004 (pilot data onboarding) until you have a real pilot sample.
