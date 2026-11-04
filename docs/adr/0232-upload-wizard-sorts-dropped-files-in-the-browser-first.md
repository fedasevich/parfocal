# 0232. The upload wizard sorts dropped files in the browser first and the server confirms

- Date: 2026-11-04
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: INGEST-021 (upload wizard with slides and results). Touches CASES-024 (sorting dropped files into cases), RSET-004 (pairing results with slides), INGEST-022 (per-file problems in the Check step) and INGEST-024 (upload progress with steps per slide)

## Context

The upload wizard of [ADR 0095](0095-ux-round-5-upload-by-slide-and-decision-notes.md) (UX round 5, upload by slide and decision notes) lists dropped files grouped by case and slide, with each result under the slide it was paired with, before anything is uploaded. The server already has `POST /api/uploads/sorting` and `POST /api/uploads/pairings` ([ADR 0125](0125-result-files-pair-in-python-and-import-as-their-own-job.md), result files pair in Python), which store nothing. The wizard must also work on the fake API of the dev build, where those routes do not exist, and it must react on every click (a pick, an Undo, a change of rule) without a round trip.

## Options considered

- Ask the server for every change. One source of truth, but a request per click, a loading state on every pick, and a fake handler that copies the Python rules anyway.
- Sort in the browser with the same documented rules, and ask the server once at Start upload. Instant, works offline of the sorting routes, and the rules fit in one pure module with unit tests.
- Sort only on the server and show the wizard after the answer. Slowest, and a drop of 5,000 files waits on one request before the person sees anything.

## Decision

The wizard sorts in the browser with `apps/web/src/upload/drop.ts`, which follows the rules of the Files step: a folder is a case, a result sits next to its slide with the same name or in a folder named like the slide, and a result that matches no slide waits in "Not matched yet". The module is pure, reads dropped folders through `webkitGetAsEntry`, and has node tests. Picks, Undo and "Leave it out" are state of the wizard and never leave the browser.

The server stays the authority. When the wizard starts the upload it will send the same files to `POST /api/uploads/sorting/apply` and pair with `PUT /api/uploads/{upload_id}/slide`, and a disagreement between the two sorters is shown on Check as a problem. That call is not wired yet. Until it is, the wizard uploads every file to the project without a case and without a slide link, and the server pairs results on import.

The wizard shows only its own uploads in the jobs tray as one row per project built from the upload engine, next to the rows from the jobs API.

## Consequences

- The Python and the browser rules can drift. The node tests in `apps/web/test/upload-drop.test.ts` pin the browser rules, and the wizard must send the server the final pairing so a drift is visible, not silent.
- Closing the wizard keeps the upload running because the engine is a module singleton. Closing the browser tab pauses it and the files must be picked again, as [ADR 0116](0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) decided. The wizard says so instead of repeating the mock's claim that a closed tab keeps going.
- Reading the slide ID inside a file is not done in the browser, so the "slide ID inside only" rule places nothing in the wizard and leaves it to the server.
