# Decisions waiting for the owner

Last updated: 2026-11-19

This file holds only what is open. Everything you have answered is in [decisions-answered.md](decisions-answered.md), newest first.

To answer a question, write your letter after "Your choice:", or leave it empty to take the recommended option.

## Your steps today

The lead opened every page in your browser. Each step ends in one click or one command of yours, because the guard leaves deleting to you. Cost $0 for all of them, and nothing here loses data the app needs.

1. **Delete the GitHub environment `staging`** (decision 91, option A). Run this in your terminal. It removes the environment with its three secrets and one variable.

   ```bash
   gh api -X DELETE repos/fedasevich/parfocal/environments/staging
   ```

2. **Revoke the Cloudflare token `parfocal-ci-staging`** (decision 91). On the Account API tokens page, open the ⋯ menu on its row and choose Delete. Leave the other six tokens alone.
3. **Revoke the Modal token `parfocal-ci-staging`** (decision 91). On Modal's API tokens page, open its row (`ak-BBp3rSa69No49uhyJ9RKnO`, no recent activity) and revoke it. Leave `parfocal-ci-prod` and the unnamed token of 2026-10-06, which is your own CLI login.
4. **Delete the old US Neon project `parfocal` (`soft-pine-86468744`, Washington)**. Production moved to `parfocal-eu` (`still-field-25034761`, Frankfurt) on 2026-11-17 and nothing points at the old one. Neon only deletes it through Vercel: on the Vercel page of the store `parfocal` (Neon ID `soft-pine-86468744`), Settings, click Delete Database at the bottom and confirm. Leave `parfocal-eu` and your other stores (`neon-red-engine`, `neon-mapa`, `viewer-ux-study-db`) alone.
5. **Let the agent's Cloudflare token read analytics** (OPS-009, storage lifecycle and cost controls). On the Account API tokens page, edit `parfocal-tofu`, add the permission Account, Account Analytics, Read, and save. The token value does not change.

When you are done, tell the lead "steps done" and it checks each one.

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
- OPS-009 (storage lifecycle and cost controls). Step 5 below, then an agent makes the first live cost report.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Record input traces on your trackpad at `/spikes/input-traces` in the local dev app, about two minutes.
- VIEW-052 (hidden tab check in headed Chrome). Keep the Mac unlocked and awake for about five minutes while an agent runs the check.

On hold by your answers: OPS-005 (continuous deployment) and SKEL-009 (CI deploys main) by decision 150, OPS-006 (observability) and OPS-007 (alerting) by decision 149, OPS-008 (backups) and SEC-014 (backup restore tests) by decision 152, OPS-014 (production for the first real user) and PILOT-004 (pilot data onboarding) until you have a real pilot sample.
