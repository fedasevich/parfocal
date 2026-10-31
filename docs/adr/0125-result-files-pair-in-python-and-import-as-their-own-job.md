# 0125. Result files pair with slides through pure rules in py-common, and a paired result upload imports as its own job once its slide is ready

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: RSET-004, INGEST-021, CASES-024, CASES-016, RSET-005, RSET-011, AIP-013

## Context

RSET-004 (pairing results with slides) asks that dropped result files pair with slides by folder shape first, then file name, then a slide ID inside the file, each with how it was paired and how sure it is, that the user can pick another slide, and that a result that matches no slide waits until one is picked. [ADR 0095](0095-ux-round-5-upload-by-slide-and-verdict-notes.md) (upload in three steps with results under their slides) puts pairing in the Files step on drop, before anything uploads. The upload API of [ADR 0116](0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) had no way to say that a file is a result, so INGEST-017 (publish step and slide status) refused such a file as `unknown`. [ADR 0122](0122-ingest-publishes-the-slide-row-only-when-it-is-ready.md) (the slide row appears only when it is ready) means a result dropped with its slide has no slide row to point at until the slide's ingest job finishes. [ADR 0077](0077-result-sets.md) (result sets) makes an imported set immutable, so its slide cannot change after import. No code wrote parsed objects into result sets yet, and the cell chunk writer is AIP-013 (result chunk store), which is not built.

## Options considered

Where the rules run:

1. A pure Python function in `parfocal_common.pairing`, called by an API route that the wizard posts the dropped paths to. One implementation, tested with pytest next to the readers, and the route also sees the slides already in the case. The browser waits for one request per drop.
2. A TypeScript package that runs in the browser. Pairing is instant and works offline, but the slides already in the project still need a request, and the rules would live apart from the Python readers that know the formats.
3. Both, with shared test vectors. Two implementations to keep equal.

Where the slide ID inside a file is read:

1. The browser reads the first 64 KiB of each result file (`file.slice(0, 65536).text()`) and sends it with the path, and the route extracts the ID in Python. Pairing still happens on drop, before upload, and the extraction stays in one place.
2. The browser extracts the ID itself and sends only the value. Less data per request, but a second parser for the Parfocal JSON slide block and the CSV slide column.
3. The API reads the header after upload. Nothing to send early, but the Files step could not show the pairing until the file had uploaded, which ADR 0095 rules out.

How the import runs:

1. Its own job kind, `result-import`, queued when a result upload is complete and its slide is ready. A result whose slide is not ready yet, or that has no slide, is a completed upload with no job, and the slide's publish step or the override route queues it later.
2. A branch inside the `ingest` job. The ingest step names are a shared tuple that the API and the worker test against each other, and a result needs none of the slide steps.
3. Queue the import job at once and let it pause until its slide is ready, then resume it when the slide publishes. The pause is committed by the engine after the step returns, so a slide that publishes in between would find no paused job to resume.

## Decision

Option 1 in each case.

- `parfocal_common.pairing.pair_results(results, slides, by)` runs four rules in order. `next-to-slide` takes a dropped slide in the same folder whose name equals the result's name or is a prefix of it before a separator such as `.`, `_` or `-`, and is sure. `folder-named-like-slide` takes a dropped slide named like the result's folder that sits in that folder or next to it, and is sure. `file-name` compares the name with every dropped slide and every slide already in the case, or in the project when no case is given, and is sure for the same name and likely for a prefix. `embedded-id` is sure when the file names a Parfocal slide ID and likely when it names a slide's file name. Within a rule the sure matches win over the likely ones and the longest slide name wins after that. Two equal best matches are a tie, which comes back with its candidates and pairs nothing. A sure match ends the search, and a likely one is kept while later rules look for a sure one. `by` can restrict pairing to the name or to the ID inside, as the mock's "Pair results by" switch does.
- `POST /api/uploads/pairings` (`pairResultFiles`) takes the dropped paths, an optional kind per file and an optional `head` of up to 64 KiB, and answers the slides, each result's pairing and the files that are neither. It stores nothing.
- `createUpload` takes `kind: "result"`, an optional `result_format` (`geojson`, `parfocal-json` or `csv`, guessed from `.geojson`, `.csv` and `.tsv`, sniffed from the content for `.json`), and either `slide_id` or `slide_upload_id`, with the rule and certainty the wizard showed. Masks and heatmaps are refused at creation until RSET-005 (import checks and fixes) can ask for their level and scale.
- `uploads` gains `kind`, `result_format`, `slide_id`, `slide_upload_id`, `pairing_rule`, `pairing_certainty` and `result_set_id` in migration `0048`. A completed result upload may have no job.
- The import job reads the file with the readers of [ADR 0070](0070-result-file-parsers.md) (result file parsers), keeps a copy under the slide's prefix, and writes regions and zones with numbers from the slide's counters, inheriting the numbers of objects that overlap an older set on the slide as OBJ-002 (IDs across result sets) decided. It writes everything in one transaction with the upload row locked, so the set is either complete or absent. Cells are counted and not written, because they need the chunk writer of AIP-013 (result chunk store), and the status says so. A file with only cells, no readable objects, no mapped columns or more than 255 classes ends with a reason code.
- `PUT /api/uploads/{upload_id}/slide` (`pairUploadWithSlide`) sets the slide or slide upload of a result before its import starts and refuses once it has started or ended, so an imported set never moves. Only the uploader may call it, as for every upload route since INGEST-001 (upload API with presigned multipart).
- Every path that reads or changes a result's slide upload locks that slide upload's row first and the result's row second, and the publish step locks the slide upload's row before it updates the waiting results, so a result that completes while its slide publishes is queued exactly once.

## Consequences

- INGEST-021 (upload wizard with slides and results) calls `pairResultFiles` on drop and after each change of the rule, sends each result with `kind`, the slide or slide upload and the pairing, and polls `getUploadStatus`, which answers `waiting` with `needs-slide`, `waiting-for-slide` or `slide-refused` for a result. Its "Not matched yet" list calls `pairUploadWithSlide`.
- CASES-024 (sorting dropped files into cases) hands result files to the same route and may reuse `kind_of` to tell slides from results.
- The status route's `kind`, `slide_upload_id`, `pairing_rule`, `pairing_certainty`, `result_format` and `result_set_id` are new fields, and `waiting` is a new status.
- RSET-011 (cells from imported files) is new. It writes the cells of an imported file into chunks once AIP-013 (result chunk store) exists. Sets imported before it have no cells, and their source file is kept so they can be imported again.
- The API reads chunk files from local disk through `app.results`, while the worker writes to object storage. RSET-011 must make the API read chunks from object storage before cells can be reviewed.
- A waiting result whose uploader leaves the project cannot be placed by anyone else. Decision 11b in [decisions.md](../decisions.md) asks whether project owners should place it.
