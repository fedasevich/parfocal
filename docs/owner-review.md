# Owner review checklist

Temporary, made on 2026-11-14. Tick a box when you agree that the task can move to done as it stands, or write a short note under it. Agents then tick the task on the board and delete this file when every box is handled. Questions with options live in [decisions.md](decisions.md), not here.

## A. Tick if you agree, nothing to run

- [ ] **VIEW-036 (renderer interface and route switching).** The engine can switch renderer routes at run time, and Viv passes the golden tests. A switch at 10x still matches, and 15 switches grow memory 5.3% against a 10% budget. The other two routes do not exist yet. This is the same question as decision 100. Read [ADR 0302](adr/0302-renderer-routes-switch-inside-the-engine-behind-lazy-loaders.md) and [the memory result](results/2026-11-14-renderer-route-switch-memory.md).
- [ ] **TILES-003 (same-origin data path).** Slide bytes come through the app's own address, so the browser sends no preflight request. Opening a slide in Chrome takes 0.63 s, against 0.35 s in INGEST-007 (open-time baseline), and is still under the 1 s budget. Tick if the 1 s budget is enough, or note "add a read cache first". See [the result](results/2026-11-03-same-origin-slide-bytes.md).
- [ ] **MEAS-000 (research check for measurements).** The sentinel node size categories and the pN wording are confirmed from AJCC and ICCR texts. The CAP protocol could not be fetched from this machine. Tick if AJCC and ICCR are enough without CAP. See [ADR 0298](adr/0298-sentinel-node-deposit-categories-and-pn-wording-from-published-staging-guidance.md).
- [ ] **VIEW-044 (prefetch where the view is heading).** Tiles ahead of a straight pan are requested early, and a zig-zag pan prefetches nothing. The time to a sharp view was measured on a busy cloud machine, 814 ms without prediction and 774 ms with it, which is within noise. Tick to accept it as is, or note "rerun on the Mac". See [the result](results/2026-11-04-prefetch-time-to-sharp.md).
- [ ] **I18N-001 (string externalisation), setup slice only.** Lingui, the provider, a pseudo-locale test and a lint rule are in, with 228 files still on the baseline list. The issue pages are converted as proof. Tick to close the task and move the area-by-area conversion to new tasks, or leave it open until every string is converted.

## B. Needs a few minutes of you on the Mac

- [ ] **DEV-008 (tablet layout).** Look at the app once at 1024×1366, for example with the Chrome device toolbar on an iPad Pro portrait. There is no tablet mock to compare with, so your eye is the check. The spec is `apps/web/e2e/tablet-layout.spec.ts`.
- [ ] **VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch).** Both wait for traces recorded on real hardware. An agent builds the trace recorder page in VIEW-056, then you spend about two minutes scrolling and pinching on the Mac trackpad, in Safari and in Chrome, plus a mouse if you have one. Nothing to do until VIEW-056 lands.
- [ ] **VIEW-028 (overlay level of detail) and VIEW-029 (cull grid for overlays).** Both need a GPU timing on your Mac: under 1 ms at overview with 81k nuclei, and under 6 ms at detail zoom with 1.6M nuclei. An agent can prepare a one-command run if you say so. Note "prepare it" here. See [the cull grid result](results/2026-11-14-overlay-cull-grid.md).

## C. Waiting on something else, nothing for you now

- **IAM-027 (sign-up and sign-in from the app's own screens).** It waits for the deploy session in decision 95 (the Zitadel login service user), which is paused until the app is ready for production.
- **OPS-005 (continuous deployment).** Paused by your answer to decision 96.
- **SEC-042 (the edge guards the real API path).** It waits for a deployed check after the next production deploy.
- **IAM-001 (identity provider as code).** It waits for the first `idp` workflow run and a staging organisation, and staging is cut for now.
- **TEST-010 (load test tooling).** It waits for staging.
- **FOUND-030 (bundle analyzer report), TEST-017 (flaky test management), TEST-036 (display panel Undo tests) and TEST-039 (local Zitadel for the end-to-end suite).** These four wait for green CI runs on `main`. `main` has been red since 2026-11-13, and an agent is fixing it now.
- **TEST-020 (showcase seed).** Its last check runs on production, so it is paused with the deploys.
- **IAM-021 (lock screen) and SHELL-012 (account menu).** They wait for the expired sign-in to return to the object, and for the manual lock item. An agent will check whether the older decisions they mention (28, the lock card's password field, and 49, the manual lock) are already answered.
- **AIP-000 (research check for AI models).** It names decision 47 (accept ADR 0202 and the AIP-002 licence rule), and an agent will check whether that was answered.

- **VIEW-017 (OME-Zarr reader).** It waits for converted real fixtures from INGEST-015, which in turn waits for decision 104 and INGEST-014 (JPEG 2000 performance decision).
- **INGEST-015 (conversion fallback worker).** It waits for decision 104 (how close a converted JPEG 2000 slide stays to its source).
- **DS-039 (animated loaders).** It waits for decision 103 (which of the five loaders). Look at them in Storybook under `Feedback/Loader proposals`.

## Anything else I need from you

- Nothing beyond decisions 100 to 104 in [decisions.md](decisions.md) (VIEW-036 tick, refusing an unstitched BIF, who sees a compare cursor, the loader pick and the conversion quality) and the boxes above. Production stays untouched until you say the app is ready.
