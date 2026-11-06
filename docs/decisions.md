# Decisions waiting for the owner

Last updated: 2026-11-04

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

## 64. Who sees the workspace security contact, from SEC-029 (security contact for each workspace)

Admins set the contact in Admin, Workspace settings. Researchers without admin rights can also read it, because the existing workspace settings permission gives them view access, and reviewers cannot see it.

- a. Keep it readable by researchers and admins. (recommended)
- b. Admins only.

Your choice:A

## 65. A de-identified workspace with no security contact, from SEC-029

The contact is required only before a workspace holds clinical data. A de-identified workspace may leave it empty, and breach notices then go to the workspace owners.

- a. Keep that fallback to the owners. (recommended)
- b. Require the contact in every workspace.

Your choice: A

## 66. Typed search text in the search page URL, from SEC-010 (PHI-safe telemetry)

The search page keeps the typed text in its address, `/search?q=...`, so a typed patient name lands in browser history and anything that records full URLs. Telemetry already drops query strings, and SEC-010 says URLs use ids, never names.

- a. Move the text out of the URL into page state, so a search link opens empty. (recommended)
- b. Keep it in the URL so searches can be shared and reloaded.

Your choice: b, but check what is the industry standard


## 67. Alt to draw an arrow or ruler from its centre, from ANN-034 (hardening the count, arrow, text, ruler and comment pin tools)

Figma draws from the centre while Alt or Option is held. QuPath has no such convention, and pathologists mostly measure from one edge of a structure to the other.

- a. No for the ruler, and add it for the arrow only if users ask. (recommended)
- b. Add it to both now, the Figma way.

Your choice: a

## 68. Comment pins in the select tool, from ANN-035 (Figma style point editing and multi-shape moves)

The select tool now picks markers, arrows, text and every drawn shape together, and Backspace or Delete removes the selection. Comment pins live in the document's pin table with a thread on the server, not in the shape table, so selecting a pin and pressing Delete would delete a comment thread with one key and no confirmation. Pins keep their own popover with a delete action.

- a. Leave pins out of the select tool, delete them only from their popover. (recommended)
- b. Let the select tool pick and move pins, and have Delete ask before removing the thread.

Your choice:b

## 69. What counts as a lymph node in a clinical report, from REPORT-024 (clinical report model and API)

A clinical report counts positive nodes, but the database has no node number. [ADR 0252](adr/0252-clinical-report-storage-per-case.md) (clinical report storage per case) counts a node as the slide's tissue block when it has one, otherwise the slide itself, so two slides cut from one block count as one node.

- a. A node is the slide's block, else the slide, as built. (recommended)
- b. Give each slide in a case its own node number that the user sets.

Your choice:

## 70. The checksum after changes to a signed evaluation, from ADJ-005 (changes after sign-off)

The owner can change decisions after sign-off with a reason, so the exported numbers no longer match the checksum stored at signing. [ADR 0257](adr/0257-changes-after-sign-off-keep-the-signed-checksum.md) (changes after sign-off keep the signed checksum) keeps the signed checksum, flags the report as changed after sign-off and lists every change with who, when, what and why. It can be reversed.

- a. Keep the signed checksum and flag the changes, as built. (recommended)
- b. Recompute the checksum after every change, so it matches the export but no longer proves what was signed.
- c. Freeze the evaluation at signing and export only that until v2 is signed.

Your choice:

## 71. A duplicate left out of a link import, from INGEST-025 (import slides from a link)

A link import leaves out a slide whose checksum is already in the project. The upload status now shows it as failed with the reason duplicate, which looks like an error.

- a. Show it as "Skipped, already in this project" with its own neutral status. (recommended)
- b. Keep it as failed with the reason duplicate.

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
