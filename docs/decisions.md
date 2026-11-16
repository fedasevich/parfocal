# Decisions waiting for the owner

Last updated: 2026-11-15

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What you need to do next, in order

1. Decisions 105 (older Ventana archives with several scan areas), 106 (who reads the sealed clinical note), 107 (how CI gets the model files for the parity test), 108 (whether experts on an annotate task may run a model), 109 (which Cloudflare token `.env` holds after the destructive action guard) and 110 (a smoke account for the browser check after each deploy) below.
2. The checks on your Mac listed under "The review column" below, when you have a few minutes.
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
- Decision 100 (VIEW-036, the renderer interface, ticked now), option A. VIEW-036 is ticked, and the Done lines of VIEW-037 (deck.gl 9.4 WebGPU route) and VIEW-038 (custom WebGPU engine route) now ask for the same goldens Viv passes, through the renderer interface.
- Decision 101 (refusing a BIF with no frame stitching), option A with your question. Fable advised keying the refusal on "overlap unknown" rather than "no stitching", so a BIF that genuinely has no overlap still opens as an exact grid, as OpenSlide does. An agent is checking OpenSlide's Ventana driver and the fixtures and makes ingest and the viewer share one rule.
- Decision 102 (who sees a cursor shared from compare), option A. Kept as built, everyone on the live slide who is not blinded.
- Decision 103 (the animated loader), option A. An agent is making Reticle the one loader and removing the other four proposals.
- Decision 104 (how close a converted JPEG 2000 slide stays to its source), option A. Fable agreed lossless is right for slides that must look correct, and added two things: the INGEST-009 check (seams and correctness) becomes exact equality for converted slides, and each pyramid level comes from the source's own level where it has one, not from a fresh downsample. The storage size is measured in a result file.
- Review checklist. TILES-003 (same-origin data path), VIEW-044 (prefetch where the view is heading) and MEAS-000 (research check for measurements) are ticked. For MEAS-000 Fable agreed AJCC and ICCR are enough, since CAP follows the AJCC pN categories, and ADR 0298 already scopes the categories to breast. The CAP check stays a TODO in that ADR. I18N-001 (string externalisation) is ticked as the setup slice, and yes, everything gets converted after it: I18N-004 (viewer, review and annotate screens) and I18N-005 (the remaining screens, then the baseline list is deleted) do that.

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

## Open decisions from the night run of 2026-11-14

### 105. Whether older Ventana iScan archives with several scan areas open

You asked to research before building. VIEW-069 (BIF with several scan areas) found, in [the research result](results/2026-11-14-bif-several-scan-areas.md), that a BIF holds one scan area per tissue piece, so such files are common. Today's DP 200 and DP 600 scanners join frames in a direction OpenSlide itself refuses, so neither OpenSlide nor Parfocal opens their files with or without several areas. Only older iScan files would gain, and Roche says those cannot be rebuilt exactly from their metadata. The refusal now has its own message instead of "unreadable".

- **A. Keep the refusal with its own message, and build area placement later together with support for the DP 200 and DP 600 join direction (recommended).** Building it now helps only older archives that cannot be rebuilt exactly anyway.
- B. Build area placement now against the public OpenSlide test file `OS-2.bif`.
- Other.

Your choice:

### 106. Who can read the sealed clinical note of a case

CASES-026 (encrypted clinical note per case) brought the note back sealed, writable only by project owners in clinical projects. As built, everyone who can see the case reads it, the same as the patient name, which includes a reviewer who only has slides of that case assigned.

- **A. Everyone who can see the case, the same as the patient name (recommended).** A reviewer reading the slide usually needs the clinical context, and it keeps one rule for patient details.
- B. Only project owners and the reviewers of that case's slides who have already submitted.
- Other.

Your choice:

### 107. How CI gets the model files for the browser parity test

MLEVAL-007 (browser parity tests) checks that the browser PathoSAM models match PyTorch, and it passes on the Mac (click mask IoU 0.9625 on WebGPU and 0.9822 on WebAssembly against a 0.96 bar, see [the result](results/2026-11-15-browser-parity-with-pytorch.md)). Its Done line asks CI to run it, but CI has none of the roughly 250 MB of model files and 200 MB fixture, so there it skips.

- **A. Publish the files once to R2 as ADR 0276 (model files stored once with a checksum list) describes, and add a WebAssembly-only CI job that downloads them with a read-only token (recommended).** This is a production write of about 450 MB, well under a cent a month of storage, plus a new read-only secret, so it waits for your yes and the deploy session.
- B. Run the test on a self-hosted GitHub runner on the Mac.
- C. Keep the Mac run and the switch that makes a skip fail when required, and tick MLEVAL-007 without CI.
- Other.

Your choice:

### 108. Whether experts on an annotate task may run a model on its slides

JOBS-007 (run a model on a selection in Annotate) lets a person send a selected shape or the current view to a model, and the cells come back as AI objects the experts fix. Starting a run needs the "run models" right on the whole project, which experts assigned to an annotate task usually do not have, so as built only project owners and researchers see the panel.

- **A. Keep it to people with the project's "run models" right, as built (recommended).** Runs cost GPU time, and the person who set up the task chooses when to spend it.
- B. Let experts assigned to an annotate task run models on that task's slides only.
- Other.

Your choice:

### 109. Which Cloudflare token `.env` holds after the destructive action guard

SEC-031 (hard stops for destructive agent actions) now refuses agents' cloud deletes, resets and rotations, and it names a limited token, `parfocal-agent-dev-staging`, in `.env.example` for you to create. `scripts/tofu.sh` reads `CLOUDFLARE_API_TOKEN` from `.env` for every root, so a dev-only token there would break the `global` and `prod` roots. The guard also sends deleting or resetting the Neon branch to you, which is stricter than ADR 0293 (production only until the first real user).

- **A. `.env` holds only the limited token, and you run `global` and `prod` with your own token in your shell (recommended).** No agent ever holds a token that can delete R2 buckets or DNS.
- B. `tofu.sh` reads a separate production token variable from `.env`, so agents can still run additive production applies.
- C. Keep today's broad token in `.env` and rely on the guard alone.
- Other.

Your choice:

### 110. A smoke account for the browser check after each deploy

OPS-016 (a real browser checks the deployed app after every deploy) added a read-only headless browser run after each production deploy. Signed out it checks the sign-in page. Signed in it opens home, a workspace, a case and a slide, and any `/api` write fails the run. The signed-in part needs a production account, which is skipped until it exists.

- **A. Make a smoke account that can only view one workspace with one case and one fixture slide, and put `PARFOCAL_SMOKE_EMAIL` as a variable and `PARFOCAL_SMOKE_PASSWORD` as a secret in the GitHub environment `production` (recommended).** The check then covers the real viewer path, and OPS-014 (prepare production for the first real user) decides later whether the account stays.
- B. Run the signed-out check only.
- Other.

Your choice:

### 111. Targets for the ingest time and pre-read time SLOs

OPS-007 (alerting and on-call) set four SLOs in [ADR 0340](adr/0340-slos-and-alerts-as-code-routed-by-email.md) (SLOs and alerts as code, routed by email). Availability (99.5 percent) and tile latency (95 percent within 60 ms, the budget of TILES-002, a CDN in front of slide storage) have a basis. Ingest time and pre-read time have no measurement yet, so their targets are guesses that decide when you get mail.

- **A. Keep 95 percent of slides viewable within 10 minutes of upload and 95 percent of AI pre-reads ready within 60 minutes, and revisit after a month of real SLI data from OPS-006 (observability stack) (recommended).**
- B. Start looser, 30 minutes for ingest and 3 hours for pre-read, so a cold GPU queue does not page.
- C. Other numbers.

Your choice:

### 112. A slide for the viewer under make dev

FOUND-040 (the edge Worker and the dev bucket under make dev) runs the edge Worker inside Vite with a read-only binding to `parfocal-dev`, but no slide opens yet. The Worker serves shared slides only from `samples/camelyon16/`, and that folder in `parfocal-dev` is empty. The format gallery slides sit under `fixtures/`, which the Worker refuses.

- **A. Upload the four CAMELYON16 samples into `parfocal-dev` through the ingest sample job once, an additive production write under ADR 0151 (standing approval within $30 a month) that adds a few GB to R2 storage, and seed them under make dev (recommended).**
- B. Let the Worker also serve `fixtures/<file>` as a shared folder, which widens a security rule but needs no upload.
- C. Leave make dev without a viewer slide for now.

Your choice:

### 113. How often the alert cycle runs in production

OPS-006 (observability stack) built `python -m parfocal_api.alert_cycle`, which folds SLI counts from the bucket, pages on burn and checks for audit events that cross workspaces ([ADR 0343](adr/0343-sli-counts-in-the-slide-bucket-and-otlp-logs-over-http.md), SLI counts in the slide bucket). Nothing runs it yet, because the deploy has no cron by design. Reading the bucket costs almost nothing, but each run that reads jobs and the audit trail wakes Neon, and Neon stays awake about 5 minutes after each wake.

- **A. A Modal cron every 5 minutes that reads only the bucket, plus the job and audit checks once an hour. About 8,600 short runs a month, estimated at a few cents of Modal compute (not measured, TODO), and Neon wakes about 720 times a month. A stuck ingest or an audit crossing can wait up to an hour before mail (recommended).**
- B. Everything every 5 minutes. Fastest mail, but Neon stays awake around the clock, about 180 compute hours a month, near the free plan limit.
- C. Only hourly. Cheapest, but an outage pages up to an hour late.

Your choice:

### 114. Where the monthly restore check puts the production dump

SEC-014 (backups and restore testing) added `.github/workflows/restore-check.yml`, which on the 3rd of each month dumps Neon `main` and restores it into a Postgres container on a GitHub-hosted runner, then compares every table. It has never run. Once real users exist, that dump holds their data on a GitHub runner for a few minutes, which is a data location question for the records of processing. It also tests a fresh logical dump, not Neon point-in-time recovery.

- **A. Keep the GitHub runner while production holds only your test data, and before the first real user move the check to a Neon recovery branch made at a past timestamp, compared and deleted in the same run. This exercises point-in-time recovery too, and costs a few minutes of Neon compute a month (recommended).**
- B. Keep the GitHub runner for good and list GitHub as a subprocessor for backups.
- C. Run the check on Modal in the EU instead of GitHub.

Your choice:

### 115. How long the slide bucket lock keeps tenant objects

R2 has no object versioning that this repository relies on, so SEC-014 (backups and restore testing) added a `cloudflare_r2_bucket_lock` rule to the environment module instead. It stops anyone from deleting or overwriting an object under `t/` for `locked_days` after it was written, 7 by default. It is validated and covered by the conftest policy but not applied. Once applied, the production reset in `reset-production.yml` and an erasure request (ADR 0090, access export and erasure) cannot remove tenant objects younger than the lock.

- **A. Keep 7 days, apply it before the first real user, and have reset and erasure skip locked objects and retry after the lock ends. One week covers a mistaken delete noticed in a weekly review (recommended).**
- B. 1 day. Reset and erasure wait at most a day, but a mistake must be caught within 24 hours.
- C. 30 days. The longest protection, and erasure answers stay inside the one month GDPR deadline only just.

Your choice:

### 116. Which Zitadel the tenant provisioning drill uses

OPS-019 (Zitadel adapter and tenant command) provisions and deprovisions a tenant against the local Zitadel from `make dev`. The drill environment run in its runbook needs a Zitadel admin token, and production has none for this.

- **A. A throwaway local Zitadel inside the drill environment. Nothing touches the production instance and it costs nothing (recommended).**
- B. A provisioning service user with its own token on the production instance, made for the drill and deleted after it.
- C. Postpone the drill until OPS-014 (preparing production for the first real user).

Your choice:

### 117. Which encoder the server embedding service runs

AISEG-008 (server embedding service) built the cache, the API and the browser side, and the browser adopts a server embedding only when its own decoder pairs with the encoder that made it ([ADR 0346](adr/0346-server-embeddings-are-float16-tiles-in-the-slide-bucket.md), server embeddings as float16 tiles in the slide bucket). The browser decoder is PathoSAM ViT-B, and a ViT-L or ViT-H embedding does not fit it.

- **A. The full precision PathoSAM ViT-B on a T4. It pairs with today's decoder and needs no new browser graph, and only the quantisation loss goes away (recommended).**
- B. PathoSAM ViT-L, with its decoder exported as a second browser graph. Possibly better masks, not measured here, but a second decoder to ship and test.
- C. No server encoding until a slow device is measured to need it.

Your choice:

### 118. Whether the auto region tool can run in best quality

AISEG-016 (prompt-pass fallback) added the five-prompt ensemble for best quality. On five TNBC images it adds 0.005 PQ for 3.7 times the decodes, but the auto layer always asks for fast quality, so best quality cannot be reached from the screen.

- **A. Leave the auto layer on fast. The gain is small and the cost is almost four times the decoding (recommended).**
- B. Let the outline tier setting choose best quality.

Your choice:

### 119. Whether parfocal.eu joins the browsers' HSTS preload list

SEC-002 (encryption in transit and at rest) turns on zone HSTS for a year with subdomains, with preload off, in `infra/tofu/global/zone.tf`. Preload makes browsers refuse plain HTTP on every `parfocal.eu` name before the first visit, and leaving the list takes months.

- **A. Keep preload off until the first real user, then decide again (recommended).**
- B. Turn preload on now and submit the domain at hstspreload.org.

Your choice:

### 120. When to add a Neon read replica for reporting

OPS-004 (database operations) planned a Neon read replica so reporting queries do not slow annotation work. No reporting load exists yet, and annotation reads already stay at 126 to 146 ms at p95 against the 250 ms target during bulk inserts. A replica is a second compute that bills while it runs, so it needs your yes under ADR 0151 (standing approval within $30 a month).

- **A. Wait. Add the replica only when reporting queries show up in the slow query list or push reads past the target (recommended).**
- B. Add a scale-to-zero replica now.

Your choice:

### 121. Which role wins when a person's SSO groups map to both roles

IAM-012 (per-organisation SSO) maps a customer IdP's groups to our two roles ([ADR 0347](adr/0347-per-workspace-saml-sso-through-zitadel.md), per-workspace SAML sign-in). When one person's groups map to both, the code gives researcher.

- **A. Researcher wins, because it is the role that can do more and the customer put the person in that group (recommended, built).**
- B. Reviewer wins, so a mapping mistake gives less access.

Your choice:

### 122. Whether to turn on previews per pull request

OPS-003 (environments) built a preview per pull request: its own Worker, Modal environment `pr-<n>`, Neon branch and `previews/pr-<n>/` prefix, deleted on close, at most 5 at once, off until the repository variable `PREVIEWS` is `true`. Published rates put one preview at about $0.10 to $0.30 a month, under $1.50 at the cap, but the budgets already total $30 and the Modal credit and the Workers Free request quota are shared with production. Turning it on also needs a separate preview Neon project, a preview Zitadel login app, the GitHub `preview` environment and an OpenTofu change adding bucket CORS for preview origins and the `previews/` cleanup rule, all listed in `docs/knowledge/platform.md`.

- **A. Keep previews off until the first real user, and test pull requests locally (recommended).**
- B. Turn them on now. An agent prepares the setup and the tofu plan, and you approve the spend.

Your choice:

### 123. Whether agents may download newer nucleus models to score them

AINUC-000 (nuclei detector and typer research check) kept PathoSAM AIS and HoVer-NeXt in ADR 0349 (nucleus detector and typer per tier) because they are the only models with held-out numbers here. CellViT++, NuLite, InstanSeg and a PathoSAM ViT-L AIS decoder were left unmeasured, because scoring them means downloading their weights from GitHub, Zenodo or Hugging Face (sizes not checked), which no agent did without your yes.

- **A. Allow a follow-up task to download InstanSeg and the PathoSAM ViT-L decoder and score them on TNBC, CryoNuSeg and NuInsSeg on the Mac (recommended).**
- B. Also allow CellViT++ and NuLite, which can only be typed on PanNuke, a set they report results on.
- C. No downloads. Keep the line-up as it is.

Your choice:

### 124. Whether to give the load workflow a production token and a session

TEST-010 (load test tooling) added the `load` workflow, which runs the Locust scenarios against `https://app.parfocal.eu` under a cap of 2 users for 60 seconds ([ADR 0350](adr/0350-load-tests-run-against-production-under-a-tiny-cap.md), load tests against production under a tiny cap). Without secrets it measures only `/api/health`. The API scenario also lists projects and searches, the tile scenario reads slide ranges through the Worker and the room scenario joins a room and times pings, and those need a read-only service token with `see-slides`, a few slide ids from your test workspace and a member session cookie, stored as the `production` environment secrets `PARFOCAL_LOAD_TOKEN` and `PARFOCAL_LOAD_SESSION` and the variables `PARFOCAL_LOAD_SLIDES` and `PARFOCAL_LOAD_ROOM`. One capped run cost about $0.002 of Modal time.

- **A. An agent mints a read-only service token in your test workspace and you add it with two slide ids, leaving rooms for later, because a session cookie expires (recommended).**
- B. Add all four, including a session cookie you copy from the browser after signing in.
- C. Keep the workflow health-only until OPS-012 (load and soak testing).

Your choice:

### 125. Whether to sign in for gated foundation models to test a better tumor map

AITUM-000 (tumor map research check) kept the MONAI CAMELYON ResNet18 as the tumor model in ADR 0351 (the v1 tumor model and its evaluation), because no foundation-model probe could be measured. H-optimus-0, UNI2-h, Virchow2 and Prov-GigaPath all sit behind a Hugging Face access form, which needs your account, and UNI2-h and Virchow2 also need an institutional email and allow only non-commercial research.

- **A. Accept the H-optimus-0 terms on your Hugging Face account and put a read token in `.env`, so a follow-up task downloads its weights (about 1.1B parameters, file size not stated) and the CAMELYON16 training slides it needs (size `TODO`, the disk is short), trains its probe and scores it on test slides on the Mac (recommended, Apache-2.0 and the only one that allows deployed use).**
- B. Also request UNI2-h and Virchow2 with an institutional email, for a thesis comparison only.
- C. No sign-in. The ResNet18 stays until a permissive model needs no form.

Your choice:

### 126. Whether one interactive embedder container is enough

AIP-007 (interactive priority gate) runs interactive embeddings in their own `embedder` pool with one container. In a local load test with a stand-in model, one or two people sending embeddings back to back while a whole-slide job ran stayed under 1 s, and four did not (worst call 1.37 s), because one GPU serves them one at a time ([result](results/2026-11-16-interactive-priority-gate-load-test.md)). A second container would take the worst case of all pools to 5.35 USD an hour, over the 5 USD hourly cap the pool check enforces, so it needs your yes.

- **A. Keep one embedder container until real use shows more than two people segmenting at once (recommended).**
- B. Allow two embedder containers and lower one batch pool's container cap so the total stays under 5 USD an hour.
- C. Raise the hourly cap to 6 USD and allow two embedder containers.

Your choice:

### 127. What FROC counts as the expected range for the tumor map job

AITUM-001 (tumor map job) is done when a CAMELYON16 test slide scores within the expected FROC range, but no range is written anywhere. The bundle reports 0.72 over 48 slides, and the best 2016 entry 0.807 (0.732 to 0.889). The new job scored 1.0 on `test_001`, the only test slide on the Mac, with all three counted lesions found and 28 false positives below them ([result](results/2026-11-16-tumor-map-job-on-test-001.md)). One slide moves in steps of a third, so it is a smoke check, not a measure.

MLEVAL-005 (tumor map evaluation) has now run three annotated test slides and one normal slide ([result](results/2026-11-16-tumor-map-evaluation-on-three-test-slides.md)). Pooled over `test_001` (large deposits), `test_065` and `test_013` (only small deposits), FROC is 0.722 on 6 counted lesions, the same as MONAI's own functions and as the bundle's 0.72. Per slide it is 1.000, 0.500 and 0.500. All six lesions are found, and FROC is lost to false positives that score as high as the small lesions (66 on the three slides, 26 on the normal `test_062`). Pooled Dice at 0.5 is 0.899, but 0.61 and 0.42 on the two small-deposit slides. The promotion gate now uses FROC 0.7222 and Dice 0.8986 on these slides as the baseline with ADR 0322's 0.01 tolerance (a candidate may fall below the reference by at most 0.01), as ADR 0351 (the v1 tumor model) said it would.

- **A. Tick AITUM-001, since the job scores the bundle's 0.72 pooled over three test slides, and keep the per-slide numbers above as the expected range: 1.0 on large deposits and about 0.5 on slides with only small ones (recommended).**
- B. Tick AITUM-001 only after a wider run, for example ten test slides with two from centre 0, because six lesions move FROC by about 0.03 each.
- C. Set a per-slide floor now, such as 0.5 on any annotated slide, and tick on that.

Your choice:

### 128. Whether the likely size range of tumor areas stays a measured percentage

AITUM-003 (areas from the tumor map) shows each area with a likely size range, which now comes from the measured size error on three CAMELYON16 test slides ([result](results/2026-11-16-tumor-area-sizes-on-three-test-slides.md)). All 8 matched deposits were within 0.05 mm of their true size, and true size over listed size ran from 0.905 to 1.144, so the range is now 0.90 to 1.15 times the listed size. Both ends come from deposits under 0.13 mm whose errors are under one 15.6 µm grid cell. Micro and macro deposits alone stay within 0.98 to 1.07. A percentage is widest where the grid is coarsest, so near the 0.2 mm line it shows about 0.18 to 0.23 mm.

- **A. Keep the measured 0.90 to 1.15 and update it after a wider run with a centre 0 macro slide (recommended).**
- B. Use about 0.98 to 1.07 from micro and macro deposits, plus a fixed margin of one grid cell, so small areas get an honest absolute range.
- C. Go back to the old ±10% until the wider run.

Your choice:

### 129. Who may map a view of a slide on the server

AITUM-009 (Map this view asks the server for its tiles) sends each view tile to the GPU, so the route needs the right to run models and a project the person owns, the same as starting a tumor map ([ADR 0357](adr/0357-the-view-map-calls-the-interactive-lane.md), the view map asks the interactive lane for one view tile at a time). Reviewers never run models, so on the real API they no longer see the "Map this view" panel. The fake API still shows it in the review workspace, as AITUM-004 (view-scoped map on demand) built it.

- **A. Only researchers who own the project map a view, as now (recommended).**
- B. Anyone who can read the slide maps a view, and the route counts the GPU seconds per person instead.
- C. Reviewers map a view only on slides of their own review task.

Your choice:

### 130. Whether "find more like these" gets a typed fixture run

AISEG-014 (find more like these, exemplar prompting) found the gesture is a no-go on PathoSAM tokens ([ADR 0359](adr/0359-find-more-like-these.md), find more like these is a no-go on PathoSAM tokens). Three exemplars find nuclei at PQ 0.754 on 39 TNBC images against 0.841 for prompting every true centroid, and TNBC has no cell kinds, so whether exemplars can pick out one kind of cell is unmeasured ([result](results/2026-11-16-exemplar-search-on-tnbc.md)).

- **A. Drop the gesture for now and revisit it only if a pathologist asks for it (recommended).**
- B. Add a task that fetches PanNuke (CC BY-NC-SA, typed nuclei) and measures ranking the auto region tool's nuclei by exemplar similarity.
- C. Add a task to try SAM 3 concept prompts on the server, which needs a sign-in for the gated weights.

Your choice:

### XXX. Whether to fine-tune a small SAM on pathology for a fast interactive tier

AISEG-000 (interactive segmentation research check) put PathoSAM ViT-B on every interactive tier and left Fast empty in [ADR XXXX](adr/XXXX-interactive-encoder-and-decoder-per-tier.md) (interactive encoder and decoder per tier). Generic MobileSAM encodes six times faster on the CPU but scores 0.573 on a TNBC click against 0.852 for PathoSAM, and no small SAM fine-tuned on pathology was found ([result](results/2026-11-16-mobilesam-on-tnbc.md)). The ViT-L download is already asked in decisions 117 and 123.

- **A. No fine-tune for now. Devices without WebGPU use a server embedding once decision 117 is taken, and Fast stays empty (recommended).**
- B. Add a task that fine-tunes MobileSAM or EdgeSAM on PathoSAM's public training sets on a Modal GPU, cost `TODO` and counted against the $30 month.

Your choice:

## The review column, what each task waits for

The temporary review checklist of 2026-11-14 is handled and deleted. What still waits is below.

- EXP-008 (moderated test support) runs ten stand-in pilot tasks, because the kit's usability test plan is not in this repository. The local kit copy in `docs/design/ux-kit/` has no test plan, and the POC's `study/README.md` describes an unmoderated round on POC screens, so its tasks were not copied. TODO: paste the kit's ten pilot tasks into `docs/design/` or edit them into the study page's task set JSON, which needs no deploy.

A few minutes of you on the Mac, when convenient:

- DEV-008 (tablet layout). Look at the app once at 1024×1366, for example with the Chrome device toolbar on an iPad Pro portrait. There is no tablet mock, so your eye is the check. The spec is `apps/web/e2e/tablet-layout.spec.ts`.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Both wait for traces recorded on real hardware. The trace recorder page from VIEW-056 is built at `/spikes/input-traces` in the dev app (`pnpm dev`), so you spend about two minutes scrolling and pinching on the Mac trackpad in Safari and Chrome there, plus a mouse if you have one, and leave the downloaded files in `~/Downloads`.
- VIEW-028 (overlay level of detail) and VIEW-029 (cull grid for overlays). Both need a GPU timing on your Mac: under 1 ms at overview with 81k nuclei, and under 6 ms at detail zoom with 1.6M nuclei. An agent prepares a one-command run for this.
- VIEW-052 (hidden tab check in headed Chrome). A locked screen makes Chrome report every tab as hidden, so the night run could not do it. Keep the Mac unlocked and awake for about five minutes while an agent runs `pnpm --filter @parfocal/viewer-engine test:hidden-tab-hardware` three times; just say "Mac unlocked" in chat.

Waiting on something else, nothing for you now:

- IAM-027 (sign-up and sign-in from the app's own screens) waits for the deploy session in decision 95 (the Zitadel login service user), paused until the app is ready for production.
- OPS-005 (continuous deployment) is paused by your answer to decision 96, and TEST-020 (showcase seed) and SEC-042 (the edge guards the real API path) wait for the next production deploy.
- IAM-001 (identity provider as code) waited for staging, which is dropped for good (ADR 0331, no staging environment), so the next session rescopes it to local dev or a drill environment.
- TEST-010 (load test tooling) now runs against production under a tiny cap, but only `/api/health` was measured there. Its tile and room scenarios wait for decision 124 (a production token and session for the load workflow), and the `load` workflow has not run yet.
- FOUND-030 (bundle analyzer report), TEST-017 (flaky test management), TEST-036 (display panel Undo tests) and TEST-039 (local Zitadel for the end-to-end suite) wait for a green CI run on `main`, which agents are fixing.
- SEC-002 (encryption in transit and at rest) waits for one `tofu apply` of the global root, which only adds zone HSTS and the pending http3 setting, then a rescan of `parfocal.eu`.
- IAM-021 (lock screen) and SHELL-012 (account menu) wait for the expired sign-in to return to the object and for the manual lock item.
- VIEW-017 (OME-Zarr reader) waits for converted real fixtures from INGEST-015 (conversion fallback worker), which an agent now finishes with lossless chunks after decision 104.

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
