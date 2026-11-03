# Decisions waiting for the owner

Last updated: 2026-11-02

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What your answers of 2026-11-02 changed

| Answer | What changed |
|---|---|
| 16a, names inside slide files | SEC-028 (identifying text in de-identified originals) blanks the identifying byte ranges with spaces when serving, and the stored original keeps its SHA-256 |
| 17a, barcodes in file headers | SEC-028 also blanks barcode header fields for readers without label rights, SKEL-006 (open the slide in Viv) reads those slides' geometry from `levels.json`, and ADR 0137 (capability tokens for slide bytes) says so |
| 19c, style of a hidden first read | Only the screen switches, and ADR 0131 (decision styles) records that the API will refuse the clashing style once the New review task warning exists |
| 20b, who may delete a project | Any owner, behind a typed confirmation, and on your note it is a soft delete that keeps every review and evaluation and can be restored. Real erasure happens only through the GDPR path. New task PROJ-010 (delete a project) builds it |
| 6a, tofu apply on `parfocal-dev` | Already applied at your yes in chat earlier today, dev only. Staging and production still lack the upload CORS and unfinished-upload rules, which a later plan will show you |
| 22, client state | ADR 0143 (one home per kind of client state) is accepted, with XState only for selected flows where a machine plainly helps |
| 23, charts | ADR 0144 (hand-made SVG charts with visx) is accepted. A chart library comes in only when our own charts break down |
| 24, tables | ADR 0145 (TanStack Table plus Virtual) is accepted |
| 25, frontend testing | ADR 0146 (frontend testing stack on node:test, Storybook and Playwright) is accepted |
| 21d, CAMELYON16 tumor maps | AITUM-003 (areas from the tumor map) stays in review until MLEVAL-005 (tumor map evaluation) makes the maps on Modal dev with a cost cap |
| 26a, keeping originals | Originals stay while their project exists, under the R2 budget alert. ADR 0147 (cloud provider, regions and pilot cost) is accepted with that |
| 26, Modal spend | Your note set the whole project to $30 a month, the compute Modal includes, with nothing running all the time in production. ADR 0151 (standing approval within $30 a month) records it, and Modal keeps its $0 spend limit |
| Your chat note on production | ADR 0151 is your one standing yes for every session and subagent. Additive production writes such as a `tofu apply` with no destroy, deploys and new settings go ahead and get logged. Anything destructive or anything that raises spend is still asked one action at a time |
| 27a, palette and hotkeys | ADR 0149 (command palette, drag and drop and hotkey registry) is accepted and STACK-014 (hotkeys) is ticked |
| 28a, lock card | IAM-021 (lock screen that returns to the same view) drops the password field and keeps one Unlock button plus the passkey button |
| 29, usability study | PILOT-005 (moderated usability study) is on hold, because the thesis topic does not require it and the POC already ran a usability study and a UI review |
| 30, device traces | You will record later when you have a mouse. VIEW-056 (guided trace recorder) builds a page that walks you through each gesture with a timer, and VIEW-021 waits for it |

Every other answer took the recommended option, and what was already built stays as built. That covers 18a (site validation sets), 19a and 19b (decision styles), 20a and 20c (sample project), and 21a, 21b, 21c and 21e (case numbers, missing scores, reassigned reviewers and the CI bypass).

## 31. Where comment threads live, from COLLAB-002 (threads API)

Threads are built on a task slide only, and at sign-off new threads stop while replies and resolving go on. ADR 0152 (threads on task slides) records both, and either is cheap to change now.

- a. Keep both as built. (recommended, because every review conversation belongs to a task)
- b. Allow threads on any slide with the task optional, or freeze all thread activity at sign-off. Say which.

Your choice:

## 32. The support address on refused uploads, from INGEST-018 (ingest failure UX)

A file refused for good shows a "Contact support" link. It points at `support@parfocal.eu`, a placeholder in `apps/web/src/upload/ingest-failure.ts`, and that mailbox does not exist yet.

- a. Keep `support@parfocal.eu` and route it to your inbox with Cloudflare Email Routing, which is free and which an agent sets up. (recommended)
- b. Use your own address directly. Write it here.
- c. Hide the link until the pilot.

Your choice:

## 33. How the browser places BIF camera frames, from VIEW-057 (BIF frame placement)

Ventana BIF slides are stitched from camera frames. The browser now places them like OpenSlide does, on one even pitch, so the server and the browser agree within 0.6 grey levels. The seams at the real frame edges stay as visible as in OpenSlide (ratio about 2.8). ADR 0164 (BIF frames placed like OpenSlide) records it.

- a. Keep OpenSlide's even pitch. (recommended, because server tiles, AI results and annotations share one set of coordinates)
- b. Use the per-boundary positions the file stores. Seams drop to about 1.5, but the reference is no longer OpenSlide and stored BIF annotations would need remapping.

Your choice:

## 34. Legal facts for the GDPR documents, from SEC-021 (GDPR documentation)

SEC-021 drafted records of processing, a DPIA for AI results review, a DPA template, the subprocessor list and a cookie and storage policy in `docs/compliance/`. They stay drafts in review until these are answered and counsel reads them.

- a. The legal entity that acts as controller and processor, with its address and contact. Write it here.
- b. Whether to name a DPO, and who.
- c. Retention periods for unaccepted invitations, ended sessions, read notifications and operator records.
- d. Whether counsel must confirm that analytics with no device storage need no consent (ADR 0171) in the first tenants' countries.
- e. Whether any clinical use needs a medical device assessment.

Your choice:

## 35. Lingui for web app strings, from I18N-000 (research check for i18n libraries)

ADR 0173 picks Lingui 6 with ICU messages, PO catalogues and the en-XA pseudo locale, matching the backend (ADR 0172). FormatJS and i18next were compared and rejected. The raw-string lint rule may need a small local oxlint plugin, because oxlint's JS plugin support is alpha.

- a. Accept Lingui (ADR 0173 becomes Accepted). (recommended)
- b. Use FormatJS (react-intl) instead.

Your choice:

## 36. Remember a slide's camera across visits, from CASE-000 (case view state model)

ADR 0176 keeps each slide's last camera only while its case is open (CASE-003 built that). The mock does not ask for more.

- a. No, forget it when the case closes. (recommended, matches the mock)
- b. Yes, remember it per device across visits.

Your choice:

## 37. Primary button hover, from DS-006 (buttons and icon buttons)

The mock lightens the filled primary button on hover with white, which drops its text below 4.5:1 contrast. DS-006 darkens it instead (12% black on hover, 24% on press), so axe passes without an exclusion.

- a. Keep the darker hover. (recommended, meets contrast)
- b. Keep the mock's lighter hover and accept the contrast exclusion.

Your choice:

## The review column, what each task waits for

Nothing else in review needs you. Nine tasks that only waited for green CI were ticked on 2026-11-02.

| Task | Waits for | Who does it |
|---|---|---|
| GUIDE-015 (decision styles in task screens) | The UI half | The next Sonnet agent, first in the queue |
| INGEST-001 (resumable upload) | INGEST-028 (upload check on the R2 dev bucket), which ADR 0151 now allows | The next Opus agent |
| CASES-009 (search API) | The latency test, which missed 100 ms only on the shared CI runner | An agent reruns it on your Mac with `PARFOCAL_PERF=1` |
| IAM-021 (lock screen) | Your answer 28a | The session already working on it |
| VIEW-021 (wheel and pinch) | VIEW-056 (a guided trace recorder), then two minutes of your scrolling when you have a mouse | An agent builds the page, then you |
| TILES-003 (same-origin data path) | Open time in Chrome is 0.63 s against INGEST-007's 0.35 s, still under the 1 s budget. Either accept the budget as enough or add a small read cache first | An agent, unless you say the budget is enough |
| AITUM-003, RSET-005 and TASK-007 | Other tasks, now shown as blocked | Agents, when those tasks land |

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
