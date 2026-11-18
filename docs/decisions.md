# Decisions waiting for the owner

Last updated: 2026-11-18

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What you need to do next, in order

1. Finish decision 153 (the seeded test account for agents). Run this in a terminal on the Mac. It makes a random password, writes `~/.config/parfocal/agent-account.env` with mode 600 and puts the password on your clipboard:
   `umask 077; mkdir -p ~/.config/parfocal; P="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)Aa1!"; printf 'PARFOCAL_AGENT_EMAIL=agent-walk@parfocal.eu\nPARFOCAL_AGENT_PASSWORD=%s\n' "$P" > ~/.config/parfocal/agent-account.env; printf %s "$P" | pbcopy; unset P`
   Then sign in to the Zitadel console as the instance admin, open Users, New, and add `agent-walk@parfocal.eu`, first name Agent, last name Tester, email verified on, paste the password and turn off "change password on first sign-in". Give it no roles. Then write "done" here.
2. Click Approve on the production deploy of the next tag when the lead starts it, as decision 137 (how production gets past the migration squash) describes.
3. When convenient, the two Kaggle downloads of decision 131 (CryoNuSeg and Lizard).
4. The checks on your Mac listed under "The review column" below, when you have a few minutes.
5. When the app is ready for production, say so, and the lead books the deploy session of decisions 93, 94 and 95.

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

## What your answers of 2026-11-18 changed

- Decision 138 (tile sharing when a lab model runs on a clinical project), option A. Connecting a lab model to a clinical project asks the project owner to confirm once that tiles go to the named server, and the confirmation is audited. Already built as JOBS-008 (confirm tile sharing before a lab model joins a clinical project) on 2026-11-17 under ADR 0370, where the model may be added but cannot run until the owner confirms.
- Decision 140 (moving production to Europe) is done under option A without the warm container. Two cleanups wait for you: delete the old US Neon project `soft-pine-86468744` (`neonctl projects delete soft-pine-86468744`), and later say whether to empty the old bucket `parfocal-dev`.
- Decision 141 (how fast a person turned off in the customer's directory loses access), option A. Access lasts up to the token lifetime, revisited before the first customer with SCIM. No work.
- Decision 142 (where a workspace's storage capacity comes from), option A with 1 TB. Capacity is a constant in code, 1 TB per workspace for now.
- Decision 143 (which tasks the "Assigned by me" tab lists), option A. The tab lists tasks in projects you own, like Team.
- Decision 144 (where the live viewer's save, live changes and conflict notices go), option A, which PROTO-023 already built. On your word, Fable reviews the placement for the best version and an agent builds what it advises.
- Decision 145 (a warm API container), option A. `min_containers` stays 0 and the API may scale to zero, with 2 to 6 s on the first call after idle.
- Decision 146 (PathoSAM ViT-L for the Best tier), option A. ViT-B stays everywhere.
- Decision 147 (how an agent checks the viewer typing tool), option B. The post-deploy browser smoke types one outline as the smoke account. You also asked for a way for agents to use a seeded account on app.parfocal.eu without typing a password, since the app is dev and is reseeded, so an agent designs that with an ADR.
- Decision 148 (where the UI visual baselines live), option B. The baselines go to R2 `parfocal-dev` under `fixtures/ui-visual/`, and CI fetches them with the read-only key of decision 132.

- Decision 139 (whether a one-factor member can switch out of a workspace that requires a second factor), option A. They set up a factor or log out, as IAM-025 (second factor at sign-in) already does. No work.
- Decision 149 (when to switch on observability export), option A. OPS-006 (observability stack) stays on hold and nothing is signed up until you unpause observability.
- Decision 150 (whether merging to main deploys production), on hold with option A. Releases stay tagged and approved, and SKEL-009 (CI deploys main to production) is on hold.
- Decision 151 (the foundation model for the tumor probe), Midnight from kaiko.ai instead of H-optimus-0. It is MIT licensed and needs no Hugging Face form or token, so decision 125 (gated foundation models) is replaced and AITUM-014 (a foundation model probe for the tumor map) now uses Midnight, with the RAM check first. The Mac has about 72 GB free, so the weights fit.
- Decision 152 (recovery objectives and backups), other. Database backups are on hold, so OPS-008 (backups and disaster recovery) and SEC-014 (backups and restore testing) go on hold and production relies on Neon's 6 hours of history until you reopen it.
- Decision 153 (the seeded test account for agents on the dev app), option A. The lead tried the Zitadel console in your Chrome, but it is signed in as your personal account, which may not add users, and agents never type passwords, so step 1 of "What you need to do next" is yours.
- Decision 154 (whether the EU GPU price counts against the $5 hourly cap), other. What matters is staying under $30 a month on Modal, which the Modal usage limit of $30 already enforces as a hard cap. The $5 hourly guard stays a base-price guard. No work.

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

## What your answers of 2026-11-16 changed

- Decision 105 (older Ventana archives with several scan areas), option A. The refusal stays with its own message, and area placement waits for the DP 200 and DP 600 join direction.
- Decision 106 (who reads the sealed clinical note), option A. Everyone who can see the case, as built in CASES-026 (encrypted clinical note per case).
- Decision 107 (model files for the browser parity test), option A. An agent publishes the PathoSAM browser files to R2 once, about 450 MB, and adds a WebAssembly-only CI job that reads them with the read-only key of decision 132.
- Decision 108 (experts on an annotate task running a model), option A. It stays with the project's "run models" right, as built.
- Decision 109 (which Cloudflare token `.env` holds), Other. One token is enough, so `.env` keeps today's token and the SEC-031 guard (hard stops for destructive agent actions) is the protection.
- Decision 110 (a smoke account for the deploy check), option A. The view-only smoke account is made in the deploy session, since deploys are paused by decision 96.
- Decision 111 (ingest and pre-read SLO targets), option A. 10 minutes and 60 minutes stay, revisited after a month of real data.
- Decision 112 (a slide for the viewer under make dev), option A. FOUND-040 (the edge Worker and the dev bucket under make dev) seeds the CAMELYON16 samples already in `parfocal-dev/fixtures/`, so no new upload is needed.
- Decision 113 (how often the alert cycle runs), Other. Observability is paused, so nothing is scheduled. OPS-006 (observability stack) and OPS-007 (alerting and on-call) are on hold, built and tested with fakes.
- Decision 114 (where the restore check puts the dump), option A. The GitHub runner stays while production holds only your test data.
- Decision 115 (how long the bucket lock keeps tenant objects), option A. 7 days, applied before the first real user.
- Decision 116 (which Zitadel the provisioning drill uses), option A. A throwaway local Zitadel, as built.
- Decision 117 (the server encoder), option A. Full precision PathoSAM ViT-B on a T4, as built.
- Decision 118 (best quality for the auto region tool), Other. Any quality is allowed, so AISEG-022 (best quality for the auto region tool) lets the outline tier setting choose best quality for the auto layer too.
- Decision 119 (HSTS preload), option A. Preload stays off until the first real user.
- Decision 120 (a Neon read replica), option A. Wait for slow reporting queries.
- Decision 121 (SSO role conflict), option A. Researcher wins, as built.
- Decision 122 (previews per pull request), option A. Previews stay off, and OPS-003 (environments) is ticked.
- Decision 123 (newer nucleus models), option A with your note. AINUC-015 (score newer nucleus models on the Mac) checks each file size and peak RAM before a full run, keeps a run under about 8 GB, and aims for the best model rather than the fastest.
- Decision 124 (a load workflow token), option A. An agent mints a read-only service token in your test workspace when deploys resume, and you add it with two slide ids.
- Decision 125 (gated foundation models), option A. When you have a minute, accept the terms at `huggingface.co/bioptimus/H-optimus-0`, make a read token at `huggingface.co/settings/tokens`, and put it in `.env` as `HF_TOKEN`. AITUM-014 (a foundation model probe for the tumor map) then runs, after decision 136 below.
- Decision 126 (embedder capacity), option A. One container, and AIP-007 (interactive priority gate) is ticked.
- Decision 127 (the tumor map FROC range), option A. AITUM-001 (tumor map job) is ticked.
- Decision 128 (the tumor area size range), option A. 0.90 to 1.15 stays until a wider run.
- Decision 129 (who may map a view), option B with your note that everyone gets all AI tools. AITUM-013 (anyone who can read a slide maps a view) opens the route and counts GPU seconds per person. Decision 108 above still keeps whole-slide runs on annotate tasks to the "run models" right, as you chose there.
- Decision 130 (a typed fixture run for "find more like these"), option B. AISEG-023 (find more like these on typed PanNuke nuclei) measures it.
- Decision 131 (CryoNuSeg and Lizard), option A. When you have a minute, sign in to Kaggle and download the two zips into the paths listed under "The review column" below.
- Decision 132 (the read-only fixtures key), option A. At your request the lead added "Account API Tokens Write" to `parfocal-tofu`, applied only the token `parfocal-fixtures-read` (1 added, 0 changed, 0 destroyed), put it in `.env`, and proved it lists `parfocal-dev` and is refused a write. INGEST-029 (shared test slides bucket) is ticked.
- Decision 133 (a small SAM fine-tune), option A with your note. Nothing is trained or fine-tuned in the thesis.
- Decision 134 (InstanSeg as the auto tool without WebGPU), option A.
- Decision 135 (the nucleus job under one hour), Other. Time is not a target, quality and use of the Modal GPUs come first. AINUC-011 (throughput target) is ticked on the measured 2.56 hours on one L4.
- Decision 136 (whether a linear probe on frozen foundation model features counts as training), option A. AITUM-014 (a foundation model probe for the tumor map) may fit a linear probe on frozen H-optimus-0 features.
- Decision 137 (how production gets past the migration squash), asked in chat on 2026-11-16 and answered "Recreate the database". Production was at revision 0110 from v0.2.0, and FOUND-035 (squash the migrations into one baseline) replaced that chain with a baseline at 0115, so the next deploy could not migrate it. The database `neondb` is dropped and recreated under ADR 0293 (production only until the first real user), the next tag is deployed onto the empty database and the "Reset production" workflow seeds it. The owner's test data in production is lost.

## The review column, what each task waits for

Last checked 2026-11-16 against `python3 scripts/board.py brief`. PR 9 (the cloud run of 2026-11-15) is merged to `main`, and PR 10 (the train after it) follows once its CI passes. Deploys stay paused by decision 96 (turning on deploys from `main`), so the tasks that wait for a deploy keep waiting. Each task is in review for one reason, listed once below.

A few minutes of you on the Mac, when convenient:

- DEV-008 (tablet layout). Look at the app once at 1024×1366, for example with the Chrome device toolbar on an iPad Pro portrait. There is no tablet mock, so your eye is the check. The spec is `apps/web/e2e/tablet-layout.spec.ts`.
- VIEW-021 (wheel, trackpad and pinch) and DEV-013 (two-finger click and Safari pinch). Both wait for traces recorded on real hardware. The trace recorder page from VIEW-056 is built at `/spikes/input-traces` in the dev app (`pnpm dev`), so you spend about two minutes scrolling and pinching on the Mac trackpad in Safari and Chrome there, plus a mouse if you have one, and leave the downloaded files in `~/Downloads`.
- VIEW-028 (overlay level of detail) and VIEW-029 (cull grid for overlays). Both need a GPU timing on your Mac: under 1 ms at overview with 81k nuclei, and under 6 ms at detail zoom with 1.6M nuclei. An agent prepares a one-command run for this.
- VIEW-052 (hidden tab check in headed Chrome). A locked screen makes Chrome report every tab as hidden, so the night run could not do it. Keep the Mac unlocked and awake for about five minutes while an agent runs `pnpm --filter @parfocal/viewer-engine test:hidden-tab-hardware` three times. Just say "Mac unlocked" in chat.
- TEST-028 (model accuracy tests that cannot be skipped unseen). An agent runs `test:accuracy` once on your Mac and writes the result file with its numbers.

Waits for a deploy of the train after PR 9 and PR 10 merge:

- SKEL-001 (production environment exists). The live checks pass, and one tenant is still unverified.
- SEC-027 (edge limits per IP). After the deploy, one login burst from one address to `app.parfocal.eu` should get a 429 at login 11.
- SEC-042 (the edge limits and the bot check guard the real API path). Run `deployed-api-origin.test.ts` against the deployed edge and API origin.
- TILES-002 (CDN in front of slide storage). It needs the deploy, the additive `tofu apply` of HTTP/3, and a warm p95 measurement over HTTP/2 and HTTP/3.
- TILES-009 (a rewritten original never comes from a stale cache). Its checks are met, and it stays in review only because TILES-002 is not deployed.
- SEC-002 (encryption in transit and at rest). One `tofu apply` of the global root, which only adds zone HSTS and the http3 setting, then a rescan of `parfocal.eu`.
- SEC-045 (isolating the remaining parse steps in a Modal sandbox). It deploys with the merge, and then a real slide of 1 to 3 GiB needs measuring.
- SEC-048 (rotation commands for the keys secret). Tested against fakes only, so the real Modal merge and the `parfocal-key-rotation` app are untried.
- AIP-021 (pre-warm trigger from a slow device through the API). It needs a warm call against the deployed GPU pool with the real PathoSAM weights.
- AITUM-010 (the tumor map job reads stored slides and runs the tumor model in its pool) and AITUM-011 (the tumor map pool is ready to deploy). The pool is ready and the artifact is published, so the deploy comes with the train merge.
- AITUM-012 (the interactive pool answers view map calls). The T4 time of one view tile is measured after the pool deploy.
- OPS-009 (storage lifecycle and cost controls). The lifecycle rules and bucket lock are applied to dev and prod (2026-11-18). Left: give the Cloudflare token the account analytics read permission, then a first live cost report. Modal's `workspace_billing_report` call in `costs.py` is also deprecated and wants `Workspace.billing.report()`. The 90 day Infrequent Access check on an old object is still to be done once objects age.
- TEST-020 (showcase seed over every feature and the real fixture slides). It waits for the next production deploy.

Waits for a decision:

- MLEVAL-010 (loaders for datasets behind a sign-in) waits for your two Kaggle downloads of decision 131 (how CryoNuSeg and Lizard reach the dataset cache). Sign in to Kaggle, download CryoNuSeg (416 MB) from `kaggle.com/datasets/ipateam/segmentation-of-nuclei-in-cryosectioned-he-images` to `~/.cache/parfocal/datasets/cryonuseg/segmentation-of-nuclei-in-cryosectioned-he-images.zip`, and the Lizard mirror (1.9 GB) from `kaggle.com/datasets/aadimator/lizard-dataset` to `~/.cache/parfocal/datasets/lizard/lizard-dataset.zip`. A browser download may be called `archive.zip`, so rename it. PanNuke and MoNuSeg already pass on their real archives.
- OPS-016 (a real browser checks the deployed app after every deploy) waits for deploys to resume, when the smoke account of decision 110 is made.
- TEST-010 (load test tooling) waits for the read-only service token of decision 124, minted when deploys resume. Only `/api/health` was measured on production, and the `load` workflow has not run yet.
- SEC-014 (backups and restore testing) keeps the GitHub runner and the 7-day lock of decisions 114 and 115, and still needs the `tofu apply` of the bucket lock and a Neon point-in-time recovery test.
- OPS-005 (continuous deployment) is paused by your answer to decision 96. You turn on the repository variable `DEPLOY_ON_MAIN` and run the rollback drill on production when you resume it.
- IAM-027 (sign-up and sign-in from the app's own screens) waits for the deploy session of decision 95 (the Zitadel login service user), paused until the app is ready for production.

Waits for a green CI run:

- FOUND-015 (container images). The images job is green. The Done line wants the Modal images built in CI, which only deploy.yml does, and decision 96 pauses it. Accept the lock resolution as the proof (ADR 0339) or add a Modal build step.
- IAM-012 (per-organisation SSO), IAM-028 (SSO from the sign-in screen) and IAM-029 (SSO domain proof by DNS). The sign-in screen test of the SSO spec is intermittent, with three passes and two failures across the train and pull request 12 runs. Pull request 12 adds an `e2e-failures` artifact to find the cause. Tick all three after a few green e2e jobs in a row.
- AITUM-009 (Map this view asks the server for its tiles). It waits for a db job that passes the tenant isolation suite, which pull request 12 fixes by naming scoreViewMapTile. The 10k cell import test of RSET-012 fails the same job and is not part of this task.
- TEST-033 (the axe scan of a route does not depend on test order). One full web run is green and ci run 43859683421 on main failed on an axe color-contrast violation on `/tasks/:id/disagreements`, so it waits for a green run after that is understood.
- TEST-008 (visual regression for UI). `ci-ok` is a required check on `main`. Run CI with `update_goldens` and commit the baselines once, after the train merges.
- TEST-015 (cross-browser matrix). Run `gh workflow run browsers --ref main` after the train merges, because the workflow is not on `main` yet.
- TEST-036 (display panel Undo tests repeat the key gesture when the Undo window is missed). Two of three ci runs on `main` are clean, one more is needed.

Waits for something else, nothing for you now:

- MLEVAL-007 (browser parity tests) has its files in R2 and the `sam-parity` workflow since 2026-11-18, and waits for that workflow's first green run after merge.

- IAM-021 (lock screen) and SHELL-012 (account menu). The expired sign-in still returns to the slide rather than the object, and SHELL-014 (lock the screen from the account menu) builds the manual lock item.
- FOUND-009 (local development environment). A cold run on a new machine is owed. The viewer part is done by FOUND-040 (the edge Worker and dev bucket under `make dev`), whose dev check draws the CAMELYON16 slide `test_065`.
- SEC-005 (data residency enforcement). Job scheduling is enforced, and pinning storage, the database and Modal functions moved to OPS-020 (region pinning).
- SEC-008 (de-identified projects). No webhook receiver exists to test that path, and file-name slide labels go to SEC-028 (labels in de-identified projects).
- SEC-013 (secrets management in all environments). Rerun the master key rotation in a drill environment under ADR 0331 (no staging environment).
- VIEW-038 (custom WebGPU engine route) waits for VIEW-073 (ID labels and compute culling on that route), and the ID labels golden is skipped there.
- AITUM-008 (the tumor map runs as a job and the API serves it). The job, route and tables are done, and the real opener and runner are AITUM-010.
- OPS-010 (tenant provisioning automation). The real Zitadel adapter, the command line entry point and a drill environment run are left.
- OPS-018 (SLI events from the workers, a realtime SLI and traces). Spans are still not exported.
- PILOT-004 (pilot data onboarding). It needs the real pilot sample and a drill environment for the dry run.
- TEST-019 (application performance on main paths). Open p95 of 3037 ms and decision p95 of 242 ms are over budget, and CMU-1 through the edge and a production build are still TODO.
- EXP-008 (moderated test support) runs ten stand-in pilot tasks, because the kit's usability test plan is not in this repository. TODO: paste the kit's ten pilot tasks into `docs/design/` or edit them into the study page's task set JSON, which needs no deploy.

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
