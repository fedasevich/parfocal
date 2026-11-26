# 0444. A result file is checked only by the import job, and a screen may draw a capped preview of it first

- Date: 2026-11-26
- Status: Accepted
- Deciders: Yurii Fedas (lead, on Fable's advice of 2026-11-26)
- Backlog: PROTO-191 (adding a result set from the viewer matches the import)

## Context

The viewer's Add a result set card from RSET-006 (add a result set from the viewer) read only GeoJSON in the browser, refused any other file, and showed the browser's bare file input. The import itself reads GeoJSON, Parfocal JSON, CSV and TSV, masks and heatmaps, and stops for the uploader's choices after its check ([ADR 0141](0141-result-imports-stop-for-choices-after-a-check.md), result imports stop for choices after a check). ADR 0141 rejected its option 3, checking in the browser, because it needs a second parser for every format. The owner still wants to see a file on the slide before it is saved, and every screen that adds results should behave the same way.

## Options considered

| Option | For | Against |
|---|---|---|
| 1. The import job stays the only checker. A screen may draw a capped, display only preview in the browser, sends the file unchanged through the upload engine and shows `ResultProblems` for the checks | One checker. The preview needs only enough reading to draw points and outlines, and a file it cannot draw is still sent | Two readers can disagree on what a file holds, so the preview must never refuse a file |
| 2. Reuse the upload page's flow (`viewer-flow.tsx`) inside the viewer | One screen for every upload | That flow is a mock that draws a canned preview, it routes away from the slide and it was built for many files and pairing |
| 3. Check every format in the browser before upload, as ADR 0141's option 3 | Instant answers | A second parser for every format, and masks and large files cannot be read in the page |

## Decision

Option 1. This amends ADR 0141's rejection of option 3, because a preview is not a check.

- A result file is checked only by the import job. Any screen may draw a preview of it in the browser before Save. The preview is display only: it never refuses a file, and a file the page cannot draw is still sent and checked after Save.
- The preview is capped. A file over about 20 MB is not read and the screen says it is too large to preview. At most 5,000 shapes are drawn, as an even sample, and the screen says how many of how many it shows. A PNG is drawn stretched over the slide at half strength. A TIFF gets no preview and a sentence saying so.
- The screen sends the original file, with its own type, through the upload engine (`useUploadEngine().addFiles` with `slideId`), and shows the engine's progress, then the import's state and `ResultProblems` for its checks. Cancel after Save cancels the upload while it runs and leaves the result out while it waits for choices, so nothing is left orphaned.
- The one exception to "unchanged" is the GeoJSON alignment of RSET-006: when the uploader shifts or scales a GeoJSON, the browser rewrites its coordinates before sending. No other format is rewritten, and the alignment fields are shown only for GeoJSON.
- The accepted suffixes are exactly the server's `FORMAT_SUFFIXES` and `SNIFFED_SUFFIXES` in `parfocal_common.result_imports`, kept in `apps/web/src/screens/upload/result-formats.ts` with a unit test that reads the Python list.

## Consequences

- The viewer card in `apps/web/src/results/add-result-set.tsx` takes every format the import reads, one file at a time, from its drop zone or from a file dropped anywhere on the slide, and points to the full upload for several files or a slide.
- `apps/web/src/results/table-preview.ts` and `parseResults` read CSV, TSV and Parfocal JSON well enough to draw. They are not validators and must not grow into one.
- No API change and no migration.
