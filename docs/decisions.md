# Decisions waiting for the owner

Last updated: 2026-11-14

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What you need to do next, in order

1. Answer decisions 100 (whether VIEW-036, the renderer interface, is ticked now), 101 (whether the app refuses a BIF with no frame stitching) and 102 (who sees a cursor shared from compare).
2. Go through the review checklist in [owner-review.md](owner-review.md) and tick what you agree with.
3. When the app is ready for production, say so, and the lead books the deploy session of decisions 93, 94 and 95.

## What your answers of 2026-11-04 changed

| Answer | What changed |
|---|---|
| 31b, threads on any slide | A thread can live on any slide with the task optional, and the sign-off rule stays. The record [threads on any slide with an optional task](adr/0230-threads-on-any-slide-with-an-optional-task.md) replaces that part of ADR 0152 (threads on task slides), and COLLAB-015 (threads on any slide) builds it |
| 32a, support address | `support@parfocal.eu` stays. OPS-013 (email routing for support and security) routes it and `security@parfocal.eu` to your inbox with Cloudflare Email Routing. You only click Cloudflare's verification email once |
| 34, legal facts | Postponed with generic defaults in `docs/compliance/`: you as the entity with a TODO for the address, no DPO yet, 30 days for unaccepted invitations and ended sessions, 90 days for read notifications, 1 year for operator records, analytics without device storage need no consent (ADR 0171), and no clinical use claimed, so no medical device assessment. SEC-030 (legal review of the GDPR documents before the first real tenant) waits for you. SEC-021 (GDPR documentation) can now be ticked |
| 33a, 35a, 45a, 47a and c | ADR 0164 (BIF frames placed like OpenSlide) was already accepted. ADR 0173 (Lingui), ADR 0197 (annotate key map and geometry libraries) and ADR 0202 (v1 model line-up) are accepted. AIP-002 (model registry) records licences and blocks nothing while STACK-031 (licence policy) is on hold |
| 36b, slide camera | A slide's camera is remembered on the device across visits, in `localStorage` keyed by user and slide. The record [a slide's camera remembered on the device across visits](adr/0229-slide-camera-remembered-per-device.md) replaces that part of ADR 0176 (case view state model), and CASE-017 (remember a slide's camera across visits) builds it |
| 38, all yes | ADR 0185 (smart minimap) is accepted. G then n starts travel from any visible mode (NAV-006), guided review uses the smart minimap (GUIDE-002), and NAV-007 picks the missing weights |
| 40a, clinical note | CASES-026 (encrypted clinical note per case) stores it sealed with a migration, a security review and no PHI in logs |
| 41a, POC doc 34 | Checked. Every lab-tagged leaf has a home in the drawer, and ADR 0189 (developer drawer) is accepted with the comparison table. LAB-000 (lab research check) can be ticked |
| 42, incident response | Standard defaults: 24 hours to tell workspaces, 72 hours to the authority, you as incident lead and privacy contact, `security@parfocal.eu` as the contact. An agent ran the tabletop on paper and recorded it. ADR 0186 (incident response) is accepted and SEC-018 (incident response runbook) can be ticked. TODO for you: a private place for full breach records |
| 44c, pathologist check | An agent reviewed the zone names and type hints as your pathologist and recorded it in ADR 0194 (confidence display rules). "Models disagree" and "Possibly not cells" replace the old zone names, and the Immune hint now names neutrophils and eosinophils. REVIEW-018 and REVIEW-019 carry the wording |
| 46a, 48a and your note on keys | ⇧N and ⇧F stay, and CMD-006 (rebinding UI) now names every key, including the Annotate keys, Add a note, zoom to selection and view history |
| 49a, manual lock | SHELL-014 (lock the screen from the account menu) builds it after IAM-021 |
| 61b, flow page density | DS-038 (flow page density token) adds 20 px comfortable and 14 px compact |

Every other answer kept what was built: 37a (darker primary hover), 39a (Alt+Left and Alt+Right for view history), 43a (record number visible in initials mode), 50a (class keys 1 to 9) and 60a (no Model warnings block when there are none).

## What your answers of 2026-11-08 changed

| Answer | What changed |
|---|---|
| 64a, 65a, 67a, 69a and 70a | Kept as built. Researchers and admins read the workspace security contact, a de-identified workspace falls back to its owners, the ruler and arrow have no draw from centre, a node is the slide's block else the slide, and a signed evaluation keeps its signed checksum with the changes flagged |
| 66b, search text in the URL | Kept in the URL as you chose. The industry check is decision 72 below |
| 68b, pins in the select tool | ANN-037 (comment pins in the select tool) builds it, with a confirmation that names how many threads a delete removes |
| 71a, duplicate in a link import | INGEST-031 (skipped status for a duplicate in a link import) builds the neutral "Skipped, already in this project" status |

## What your answers of 2026-11-09 changed

| Answer | What changed |
|---|---|
| 72a, search text out of the URL | HOME-012 (search text out of the page URL) moves the typed text into page state. Sharing a search waits for saved searches with ids |
| 73a, 74a and 75a | Kept as built. Anyone signed in may create one workspace, the wheel zoom check measures main-thread task time in CI with frame time as a manual budget, and a matching email domain joins at once by default |
| 76a, guided check keys | Kept as built. Fix, delete, skip and start are already rebindable in Settings, Shortcuts, so each person can move them |
| 77a, compare offset | CMP-008 (keep an aligned compare offset per slide pair) saves it as a private setting per pair |
| 78a, slide threads when blinded | COLLAB-020 (slide threads stay hidden during a blinded review) hides them until the reviewer submits |
| 79a, two workspaces on one domain | Kept as built. Setup offers every matching workspace |
| 80a, owner blind too | Kept as the default. COLLAB-021 (turn blind first off on a running annotate task) lets the owner switch it off at any time |

## What your answers of 2026-11-13 changed

| Answer | What changed |
|---|---|
| 81a, production first | You first chose staging before more features. Later on 2026-11-13 you cut staging, so production is the only cloud environment until the first real user ([ADR 0293](adr/0293-production-only-until-the-first-real-user.md), production only until the first real user). The production slice heads the picking order in `docs/README.md` and `knowledge/agent-workflow.md`: OPS-002 (deploy definitions), SKEL-001 (production environment exists), OPS-005 (continuous deployment) and SKEL-009 (CI deploys main to production). No other new task starts until the real end-to-end specs pass on production. OPS-014 (bring back staging before the first real user) holds the trigger |
| 82a, thesis claims | The thesis claims only measured results and public dataset ground truth, and `project/agent-stand-in-records.md` says so |
| 83b, no date | No milestone is gated on a date. The roadmap notes the hand-in around April or May 2027 |
| 84a, workspace mail domain | IAM-026 (a workspace on a shared mail domain is not open to strangers) builds it: a new workspace saves no domain and an admin turns joining by domain on |
| 85a, presence when blinded | SEC-040 (presence in a blinded task) builds it: a reviewer who has not submitted neither receives presence nor is announced |
| 87b, old state file | Deleted on 2026-11-13 after checking the four new state files exist |
| 89a, wildcard DNS | The record `*.parfocal.eu` (A to the old Endora host) was deleted on 2026-11-13. The apex, `www`, mail and TXT records stay |
| 90, Neon region | Your note said keep it near Modal. Modal's base plan has no region pin and runs in US East by default, and ADR 0003 (pilot platform architecture) puts Neon next to Modal, so the project stays in `aws-us-east-1`. PostGIS 3.6.4 worked on Neon Postgres 18.7 on a throwaway branch on 2026-11-13, so the project stays and local development and CI move to Postgres 18 in OPS-002 (deploy definitions). Regions get pinned to the EU at the first tenant with real patient data, as ADR 0003 says |
| 92b, buckets | `parfocal-staging` was deleted on 2026-11-13 and taken out of the `staging` root's state, so that root would create it again when OPS-014 (bring back staging) runs. `parfocal-prod` stays empty for when production gets its own bucket |
| 88a, deploy credentials | Done on 2026-11-13. The GitHub environment `production` holds `CLOUDFLARE_API_TOKEN` (with R2 read), `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `NEON_API_KEY` (scoped to project `parfocal`) and `ZITADEL_SA_JSON`, and the variables `CLOUDFLARE_ACCOUNT_ID`, `ZITADEL_ORG_ID` and `NEON_PROJECT_ID` |
| 86a, database test speed | TEST-027 (database tests in parallel) is ticked at 15 to 18 minutes |

## What your answers of 2026-11-14 changed

- Decision 96 (turning on deploys from `main`), option B. Nothing deploys for now, because the app should be more ready for production first. OPS-005 (continuous deployment) stays in review, and the deploy session of decisions 93 (what the first production deploy still needs), 94 (how the first deploy gets past the environment rules) and 95 (the Zitadel login service user) waits until you say the app is ready. `knowledge/agent-workflow.md` now puts tasks that close epics and milestones first instead of the production slice.
- Decision 97 (a deleted AI object counts as checked before submit), option A. An agent is changing the submit gate of TASK-008 (submit a slide review) so a deleted AI object no longer blocks the submit, while a skipped one still does.
- Decision 98 (a blinded task hides "Share my view"), option A. An agent is hiding sharing, following and the shared cursor while the reader is blinded on that slide.
- Decision 99 (a person in compare can send their own cursor), option B. The same agent adds "Share my cursor" to the compare toolbar right after decision 98.

## Open decisions from cutting staging (ADR 0293, production only until the first real user)

### 91. Delete the GitHub environment `staging` and the staging tokens

Nothing deploys to staging any more. The GitHub environment `staging` still holds `CLOUDFLARE_API_TOKEN`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` and the variable `CLOUDFLARE_ACCOUNT_ID`, and the Cloudflare token `parfocal-ci-staging` and the Modal token behind them are still valid. Deleting is a destructive action, so it needs your yes. The command is `gh api -X DELETE repos/fedasevich/parfocal/environments/staging`, which removes the environment with its secrets and variable, cost $0. The two tokens are then revoked by hand, `parfocal-ci-staging` under API Tokens in the Cloudflare dashboard and the staging token under Settings, API Tokens in the Modal dashboard, cost $0. When staging returns, OPS-014 (bring back staging before the first real user) makes all of it again in a few minutes.

- **A. Delete the environment and revoke both tokens once production has deployed from CI with its own secrets (recommended).** Unused valid tokens are only a risk, and waiting keeps a fallback until the production ones are proven.
- B. Delete and revoke now.
- C. Keep them for the day staging returns.
- Other.

Your choice: a. The lead deletes and revokes once production has deployed from CI.

### 93. What the first production deploy still needs

OPS-002 (deploy definitions) is written and tested locally and deployed nothing. The details are in [knowledge/deploy.md](knowledge/deploy.md). Besides the Neon API key of decision 88 (credentials that the production deploy needs), the first deploy needs three things from you. PostGIS was checked on Neon Postgres 18 on a throwaway branch on 2026-11-13 and works, so the Neon project stays.

- **A. Do all three with the lead in the first deploy session (recommended).** You create an R2 S3 access key limited to the bucket `parfocal-dev` with object read and write for the API. The lead adds `https://app.parfocal.eu` to that bucket's CORS origins in the dev OpenTofu root, an in-place change checked with `tofu plan`. Email, error reports and analytics start switched off through `EMAIL_BACKEND`, `ERROR_BACKEND` and `ANALYTICS_BACKEND` overrides until Resend, Sentry and PostHog keys exist.
- B. The same, but with real Resend, Sentry and PostHog keys from the first deploy.
- C. Wait with the first deploy until staging returns in OPS-014 (bring back staging).
- Other.

Your choice: a

### 94. How the first production deploy gets past the environment rules

Bootstrap ran on 2026-11-13 and the secrets are in place. The first `Deploy` run was refused before it started, because the GitHub environment `production` only deploys from tags matching `v*` and needs your approval click. No `v*` tag exists yet. ADR 0014 (Conventional Commits and releases cut locally with git-cliff) makes a release a deliberate step whose first version is `v0.1.0`, and pushing the tag publishes a public GitHub release with a changelog.

- **A. Cut `v0.1.0` with `pnpm release`, push it, start `Deploy` on that tag, and you click Approve in GitHub Actions (recommended).** It keeps the rule that only tagged, approved code reaches production. Cost $0.
- B. Add `main` to the environment's allowed branches, so `Deploy` runs from `main` and still waits for your approval. A GitHub settings change.
- Other.

Your choice: a

### 95. The Zitadel login service user for the app's own sign-up and sign-in

IAM-027 (real sign-up and sign-in from the app's own screens) is built and tested against a faked Zitadel, as [ADR 0294](adr/0294-native-sign-up-and-sign-in-through-zitadel-session-api.md) (native sign-up and sign-in through Zitadel's session API) describes. Until the API has a login token it keeps sending people to the hosted Zitadel login, so nothing changes in production yet. Turning it on is a production write that creates a credential, so it waits for you.

- **A. You and the lead do it in one session (recommended).** In the Zitadel console you create a machine user named `parfocal-login`, give it the instance role `IAM_LOGIN_CLIENT` and create a personal access token for it. The lead then adds `ZITADEL_LOGIN_CLIENT_ID` (the machine user's id) and `ZITADEL_LOGIN_TOKEN` (the token) to the Modal secret of the API in environment `main`, and optionally `ZITADEL_ORGANIZATION_ID` so new people land in one organisation. In the same session the lead switches the email code generator to digits only, checks the password complexity policy against the app's hint text, checks that Zitadel's own mail sends the code, and tries one real sign-up with a throwaway address. Cost $0.
- B. Keep the hosted login for now and leave IAM-027 in review.
- Other.

Your choice: a

### 100. Whether VIEW-036 (renderer interface and route switching) is ticked now

VIEW-036 built the renderer interface and the switch between routes inside the engine ([ADR 0302](adr/0302-renderer-routes-switch-inside-the-engine-behind-lazy-loaders.md), renderer routes switch inside the engine behind lazy loaders). Its Done line asks for the same golden tests on all three routes, but only Viv exists. The goldens pass on Viv, a switch at 10x still matches, and 15 switches grow the heap 5.3% against a 10% budget.

- **A. Tick VIEW-036 now and add "the goldens pass on this route" to the Done lines of VIEW-037 (deck.gl 9.4 WebGPU route) and VIEW-038 (custom WebGPU engine route) (recommended).** The interface is finished, and each new route proves itself when it lands.
- B. Leave VIEW-036 in review until both routes exist.
- Other.

Your choice:

### 101. Whether the app refuses a BIF that has no frame stitching

VIEW-014 (Ventana BIF with frame stitching) opens a BIF in the app with the frame positions from its sidecar. When the sidecar is missing or holds no stitching, the reader draws the camera frames as a plain grid, as [ADR 0164](adr/0164-bif-frames-placed-like-openslide.md) (BIF frames placed like OpenSlide) says, and the tissue in every frame overlap shows twice. Ingest refuses such a file today, so this happens only if a sidecar is lost.

- **A. Refuse to open it in the app and say the slide needs re-ingest (recommended).** Nobody reviews a slide with repeated tissue by accident.
- B. Keep opening it as a plain grid.
- Other.

Your choice:

### 102. Who on the live slide sees the cursor of a person in compare

Decision 99 added "Share my cursor" to compare. As built, everyone on the live slide who is not blinded sees that cursor, the same as a cursor shared from the live slide ([ADR 0304](adr/0304-a-shared-cursor-is-a-second-capped-frame-in-shares-of-the-slide.md), a shared cursor is a second capped client frame).

- **A. Everyone on the live slide who is not blinded, as built (recommended).** Sharing is already a deliberate act by the sharer.
- B. Only people who turn on "Show shared cursors" themselves.
- Other.

Your choice:

## The review column, what each task waits for

The tasks in review, each with a short summary and what you would check, are in [owner-review.md](owner-review.md), a temporary checklist.

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
