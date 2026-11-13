# Decisions waiting for the owner

Last updated: 2026-11-13

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

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
| 81a, staging first | The staging slice heads the picking order in `docs/README.md` and `knowledge/agent-workflow.md`: OPS-001 (base infrastructure as code), OPS-002 (deploy definitions), IAM-001 (identity provider setup as code), SKEL-001 (staging environment exists), OPS-005 (continuous deployment) and SKEL-009 (CI deploys main to staging). No other new task starts until the real end-to-end specs pass on staging |
| 82a, thesis claims | The thesis claims only measured results and public dataset ground truth, and `project/agent-stand-in-records.md` says so |
| 83b, no date | No milestone is gated on a date. The roadmap notes the hand-in around April or May 2027 |
| 84a, workspace mail domain | IAM-026 (a workspace on a shared mail domain is not open to strangers) builds it: a new workspace saves no domain and an admin turns joining by domain on |
| 85a, presence when blinded | SEC-040 (presence in a blinded task) builds it: a reviewer who has not submitted neither receives presence nor is announced |
| 86a, database test speed | TEST-027 (database tests in parallel) is ticked at 15 to 18 minutes |

## Open decisions from OPS-001 (base infrastructure as code)

### 87. Delete the old OpenTofu state file

The state moved to four files, one per root (ADR 0287, one OpenTofu root per environment). The old file `parfocal.tfstate` in bucket `parfocal-tfstate` is now an unused encrypted copy that still holds all three login app secrets. Deleting is a destructive action, so it needs your yes. The command is `npx wrangler r2 object delete parfocal-tfstate/parfocal.tfstate`, cost $0.

- **A. Delete it once staging has deployed from the new roots (recommended).** It stays as a fallback for the few days OPS-002 (deploy definitions) and SKEL-001 (staging environment exists) take.
- B. Delete it now.
- C. Keep it.
- Other.

Your choice:

### 88. Credentials that the staging deploy needs

On 2026-11-13 you and the infra guide already made most of them. The GitHub environment `staging` holds the Cloudflare token `parfocal-ci-staging` (Workers Scripts Edit and Account Settings Read on the account, Workers Routes Edit, DNS Edit and Zone Read on `parfocal.eu`, expires 2027-11-13), the account ID as a variable, and a Modal token. Two things are still missing.

- **A. Create a Neon API key and add R2 read to `parfocal-ci-staging` (recommended).** The Neon key is scoped to project `parfocal` if Neon offers project scope, else a personal key, and goes into the `staging` environment as `NEON_API_KEY` the same clipboard way. R2 read lets the deploy check the staging bucket exists.
- B. Only the Neon key, and the deploy reads bucket names from `tofu.sh staging output -json` instead.
- C. Deploy to staging only from your Mac for now, with your own Wrangler and Modal logins.
- Other.

Your choice:

### 89. The old web host's DNS records on parfocal.eu

The zone still points the apex, `www` and a wildcard `*.parfocal.eu` at the old Endora web host, with Endora mail records. The wildcard means every unknown hostname, such as a mistyped preview name, serves the old host's page through Cloudflare. `staging.parfocal.eu` and `app.parfocal.eu` are not affected, because a Workers Custom Domain makes its own record, which wins over the wildcard. Removing a record is a delete, so it needs your yes.

- **A. Remove only the wildcard record now and keep the apex, `www` and mail records until the marketing page and OPS-013 (email routing for support and security) replace them (recommended).**
- B. Keep everything as it is until launch.
- C. Remove the wildcard, apex and `www` records now and leave the root domain unresolved.
- Other.

Your choice:

### 90. The Neon project is Postgres 18 in US East, while tests run PostGIS on Postgres 17

The Neon project `parfocal` was created through Vercel on 2026-10-06 as Postgres 18 in `aws-us-east-1` and has not been used since. Local development and CI run Postgres 17 with PostGIS, and the region was never measured against Modal (STACK-020, database hosting). A Neon project cannot change its region or go down a major version, so this is cheap only before staging holds data.

- **A. Let OPS-002 measure latency from Modal to US East and to an EU region first, then either keep this project or ask you to create a new one in the faster region on Postgres 17 in the Vercel dashboard, the only place this organisation allows it (recommended).** Whether the free plan allows one more project next to your five was not checked.
- B. Keep the project as it is and move local development and CI to Postgres 18.
- C. You create a new Postgres 17 project in an EU region now in the Vercel dashboard, without measuring.
- Other.

Your choice:

## The review column, what each task waits for

Nothing else in review needs you. Nine tasks that only waited for green CI were ticked on 2026-11-02.

| Task | Waits for | Who does it |
|---|---|---|
| GUIDE-015 (decision styles in task screens) | The UI half | The next Sonnet agent, first in the queue |
| INGEST-001 (resumable upload) | INGEST-028 (upload check on the R2 dev bucket), which ADR 0151 now allows | The next Opus agent |
| CASES-009 (search API) | The latency test, which missed 100 ms only on the shared CI runner | An agent reruns it on your Mac with `PARFOCAL_PERF=1` |
| IAM-021 (lock screen) | The expired sign-in returning to the object, not only the slide | The session already working on it |
| VIEW-021 (wheel and pinch) | VIEW-056 (a guided trace recorder), then two minutes of your scrolling when you have a mouse | An agent builds the page, then you |
| TILES-003 (same-origin data path) | Open time in Chrome is 0.63 s against INGEST-007's 0.35 s, still under the 1 s budget. Either accept the budget as enough or add a small read cache first | An agent, unless you say the budget is enough |
| AITUM-003, RSET-005 and TASK-007 | Other tasks, now shown as blocked | Agents, when those tasks land |

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
