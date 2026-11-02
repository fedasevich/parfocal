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
| 21d, CAMELYON16 tumor maps | AITUM-003 (areas from the tumor map) stays in review until MLEVAL-005 (tumor map evaluation) makes the maps on Modal dev with a cost cap |

Every other answer took the recommended option, and what was already built stays as built. That covers 18a (site validation sets), 19a and 19b (decision styles), 20a and 20c (sample project), and 21a, 21b, 21c and 21e (case numbers, missing scores, reassigned reviewers and the CI bypass).

## 22. Client state, from STACK-005 (client UI state)

ADR 0143 (one home per kind of client state) is Proposed. It keeps server data in TanStack Query, shareable views in the URL, frame values in the viewer engine, UI state shared across panels in Zustand, flows with named states and guards in XState, and anything kept between visits in the settings layers. No package is installed yet. SHELL-005 (inspector panel with resize and hide) would add Zustand and NAV-006 (smart minimap state machine) would add XState.

- a. Accept ADR 0143 as written. (recommended)
- b. Use Zustand for the machines too and skip XState.
- c. Something else, say what.

Your choice:

## 23. Charts, from STACK-011 (charts for dashboards and confidence visuals)

ADR 0144 (charts are hand-made SVG with visx) is Proposed. Charts are React SVG components in `packages/ui`, with visx scales and axes only when a chart needs an axis or many series, coloured only by token variables and always readable as a table or a stated label. It leaves Observable Plot out of the app, against the backlog default, because no planned in-app chart needs it. In a scratch build visx added 16 to 25 KB gzipped over React and Plot 98 KB. No package is installed yet.

- a. Accept ADR 0144 as written, with Plot reconsidered only if an in-app dashboard such as HOME-004 (department dashboard) is planned. (recommended)
- b. Add Observable Plot now for dashboard charts, as the backlog default said.
- c. Something else, say what.

Your choice:

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
