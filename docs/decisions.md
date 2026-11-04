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

Your choice: B let's be able to comment any slide even  if there is no task

## 32. The support address on refused uploads, from INGEST-018 (ingest failure UX)

A file refused for good shows a "Contact support" link. It points at `support@parfocal.eu`, a placeholder in `apps/web/src/upload/ingest-failure.ts`, and that mailbox does not exist yet.

- a. Keep `support@parfocal.eu` and route it to your inbox with Cloudflare Email Routing, which is free and which an agent sets up. (recommended)
- b. Use your own address directly. Write it here.
- c. Hide the link until the pilot.

Your choice: A

## 33. How the browser places BIF camera frames, from VIEW-057 (BIF frame placement)

Ventana BIF slides are stitched from camera frames. The browser now places them like OpenSlide does, on one even pitch, so the server and the browser agree within 0.6 grey levels. The seams at the real frame edges stay as visible as in OpenSlide (ratio about 2.8). ADR 0164 (BIF frames placed like OpenSlide) records it.

- a. Keep OpenSlide's even pitch. (recommended, because server tiles, AI results and annotations share one set of coordinates)
- b. Use the per-boundary positions the file stores. Seams drop to about 1.5, but the reference is no longer OpenSlide and stored BIF annotations would need remapping.

Your choice: A

## 34. Legal facts for the GDPR documents, from SEC-021 (GDPR documentation)

SEC-021 drafted records of processing, a DPIA for AI results review, a DPA template, the subprocessor list and a cookie and storage policy in `docs/compliance/`. They stay drafts in review until these are answered and counsel reads them.

- a. The legal entity that acts as controller and processor, with its address and contact. Write it here.
- b. Whether to name a DPO, and who.
- c. Retention periods for unaccepted invitations, ended sessions, read notifications and operator records.
- d. Whether counsel must confirm that analytics with no device storage need no consent (ADR 0171) in the first tenants' countries.
- e. Whether any clinical use needs a medical device assessment.

Your choice: let's postpone it for now, if possible let's have generic good enough for now things there

## 35. Lingui for web app strings, from I18N-000 (research check for i18n libraries)

ADR 0173 picks Lingui 6 with ICU messages, PO catalogues and the en-XA pseudo locale, matching the backend (ADR 0172). FormatJS and i18next were compared and rejected. The raw-string lint rule may need a small local oxlint plugin, because oxlint's JS plugin support is alpha.

- a. Accept Lingui (ADR 0173 becomes Accepted). (recommended)
- b. Use FormatJS (react-intl) instead.

Your choice: A

## 36. Remember a slide's camera across visits, from CASE-000 (case view state model)

ADR 0176 keeps each slide's last camera only while its case is open (CASE-003 built that). The mock does not ask for more.

- a. No, forget it when the case closes. (recommended, matches the mock)
- b. Yes, remember it per device across visits.

Your choice: B

## 37. Primary button hover, from DS-006 (buttons and icon buttons)

The mock lightens the filled primary button on hover with white, which drops its text below 4.5:1 contrast. DS-006 darkens it instead (12% black on hover, 24% on press), so axe passes without an exclusion.

- a. Keep the darker hover. (recommended, meets contrast)
- b. Keep the mock's lighter hover and accept the contrast exclusion.

Your choice: A

## 38. Smart minimap, from NAV-000 (minimap state machine and placement)

ADR 0185 (proposed) makes the minimap one state machine with size modes hidden, reading, area, locator and travel, a fade flag and the Z peek, placed by the mock's corner scoring. Three choices the kit leaves open:

- a. Should G then n also start travel from area or locator mode, not only from reading? (recommended: yes, from any visible mode)
- b. Should guided review drop its own fixed 136 px minimap and use the smart minimap? (recommended: yes)
- c. Weights for an open thread, the floating cells panel, proposals and pins in corner scoring are not in the kit. (recommended: NAV-007 picks them and records them in ADR 0185)
- d. Accept ADR 0185.

Your choice: all yes

## 39. Keys for view history back and forward, from VIEW-047 (view history)

The viewer now flies back and forward through the views you left. The default keys are Alt+Left and Alt+Right, which override the browser's own back and forward keys while the viewer has focus (on Windows and Linux).

- a. Keep Alt+Left and Alt+Right. (recommended, they match browser habit and people can rebind them)
- b. Use [ and ] instead and leave the browser keys alone.

Your choice: A

## 40. The clinical note in case details, from CASE-011 (case header details)

The slide picker's case details now show project, case, specimen, blocks, the task and its researcher, and in clinical projects a clinical note row. ADR 0054 removed `cases.clinical_note`, so that row always reads "No clinical note".

- a. Add a backlog task to store an encrypted clinical note per case, with a migration. (recommended if clinical projects need the note on screen)
- b. Drop the clinical note row from the picker.

Your choice: A

## 41. Checking the developer drawer against POC doc 34, from LAB-000 (lab research check)

ADR 0189 (proposed) confirms the developer drawer's ten sections in four groups, the nine LAB-001 controls and the `window.__parfocal` handle against the frozen kit, the mock's developer screen and the PROTO-016 code. POC doc 34 lives in the private POC repository, which this session was not allowed to attach, so its lab-tagged leaves are unchecked. "Kit W25" does not exist in the frozen kit, so LAB-001 now points at the "Developer mode, Viv by default" gallery group.

- a. Give one session read access to the POC repository to check doc 34, then accept ADR 0189.
- b. Accept ADR 0189 without that check.

Your choice: A you can check it for that it was good there

## 42. Incident response facts, from SEC-018 (incident response and breach notification runbook)

SEC-018 wrote the runbook (`docs/compliance/incident-response.md`), an empty breach register, a ready tabletop scenario with an empty record, and ADR 0186 (proposed). Every alert channel today is about cost only. It stays in review until these are settled.

- a. Confirm 24 hours as the deadline for telling workspaces (DPA clause 4.6), or give counsel's number.
- b. Name the incident lead, deputy, privacy contact, counsel, the supervisory authority (depends on the legal entity in 34a) and one security contact address.
- c. Choose a private place for full breach records, because this repository is public.
- d. Run the tabletop exercise and record it.

Your choice: let's do some industry standard good thing

## 43. Record number in initials mode, from CASE-010 (patient banner)

Clinical case screens now show the patient banner (name, sex, age, record number), and the lab can lock initials mode for names. The record number is also a direct identifier, and today it stays visible in initials mode.

- a. Keep it visible (current build).
- b. Hide it in initials mode. (recommended, initials mode is meant to hide identity)
- c. Show only its last 3 digits.

Your choice: A

## 44. Pathologist check of zone names and type hints, from REVIEW-000 (review research check)

ADR 0013 asked REVIEW-000 for a pathologist to confirm the zone names ("tumor or immune") and the type hints. No doctor has done that yet. ADR 0194 confirms the confidence display rules for HoVer-NeXt only, because no typer is chosen yet (AINUC-000).

- a. Fold it into the round 4 pilot. (recommended)
- b. Add a separate task for a pathologist wording review.
- c. Drop it.

Your choice: c there won't be ever pathlogist, do what you know is good for that please act like my pathlogist

## 45. Annotate key map and geometry libraries, from ANN-000 (annotate research check)

ADR 0197 (proposed) keeps the kit key map, adds hold Space to pan and Alt as a second brush erase key, and picks Clipper2 (`clipper2-ts`), earcut (`@math.gl/polygon`) and `flatbush` with our own planar measures. Turf is rejected because its measures are geodesic. QuPath uses M for move, and the kit uses M for the count marker.

- a. Keep M only for markers, and accept ADR 0197. (recommended)
- b. Also accept QuPath's "." for markers.

Your choice: A, it probably can be configurable

## 46. The Add a note key, from DS-030 (every key hint from the key registry)

N is No in the yes or no decision style, so "Add a note" moved from N to ⇧N. People can rebind it.

- a. Keep ⇧N. (recommended, one key in every style)
- b. Use C, the same key as Comment.
- c. N in every style except yes or no.

Your choice: A, all of it has to be configurable probably

## 47. The v1 model line-up, from AIP-000 (AI pipeline research check)

ADR 0202 (proposed) sets PathoSAM AIS for outlines, HoVer-NeXt for typing, the MONAI CAMELYON ResNet18 for the tumor map and PathoSAM ViT-L and ViT-B for click and box. Every v1 model is non-commercial or has an unconfirmed licence. Hugging Face, Zenodo and arXiv were unreachable, so those licences are copied from ADR 0042 and marked not re-read.

- a. Accept ADR 0202 as the v1 starting line-up. (recommended for the thesis and pilot, which are non-commercial)
- b. Change rows first. Write which here.

AIP-002 also requires a licence block, which conflicts with STACK-031 (licence policy) being on hold:

- c. Record licences only and block nothing while STACK-031 is on hold. (recommended)
- d. Drop that condition from AIP-002.
- e. Keep the block.

Your choice: a,c

## 48. The zoom to selection key, from NAV-012 (zoom to selection)

NAV-012 asks for Shift+2, but the approved mock and kit give Shift+1 to Shift+4 to display presets, and the default keymap must have no clashes. It is built on ⇧F for now, and people can rebind it.

- a. Keep ⇧F. (recommended, F already means fit)
- b. Use Shift+2 and move the display presets, which changes the mock.
- c. Another key, such as "." or ⇧0.

Your choice: A, make it configurable

## 49. A manual Lock the screen in the account menu, from SHELL-012 (account menu)

The account menu shows "Lock the screen" disabled. Building it needs LockCard wording for a manual lock instead of "after N minutes" (IAM-021, in review).

- a. Yes, build a manual lock in the menu. (recommended, quick to leave a workstation safely)
- b. Drop it from the menu.

Your choice: A

## 50. How many class keys, from ANN-011 (classes and keys 1 to 4)

The task title says keys 1 to 4, but its note says keys follow the project taxonomy up to 9 (PROJ-004). It is built with 1 to 9 in the annotate scope only, so it never clashes with the decision digits in review.

- a. Keep 1 to 9. (recommended, matches the taxonomy limit)
- b. Narrow to 1 to 4 as the title says.

Your choice: A

## 60. Model warnings when there are none, from REVIEW-023 (model warnings in the inspector)

The inspector's Model warnings block lists what the rules of ADR 0194 find.

- a. Hide the block when there are no warnings (built). (recommended, keeps the inspector quiet)
- b. Show a quiet "No model warnings for this slide" line.

Your choice: A

## 61. Flow pages and density, from DS-023 (flow page with the shared stepper)

Flow pages keep the mock's fixed 20 px gap in the main column (`.fp-main`), while other pages now tighten in compact density (DS-033).

- a. Keep the mock's fixed 20 px.
- b. Add a flow page density token, 20 px comfortable and 14 px compact. (recommended, matches the rest of compact mode)

Your choice: b

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
