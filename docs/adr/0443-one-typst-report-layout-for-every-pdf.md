# 0443. Every report PDF uses one Typst layout with the app's font, and a signed clinical report is drawn from a server model pinned to the screen model

- Date: 2026-11-26
- Status: Accepted
- Amended by: [ADR 0447](0447-report-pdfs-print-the-readers-zone-and-the-screens-line-box.md) (report PDFs print the reader's time zone and lay out text in the screen's line box)
- Amended by: [ADR 0448](0448-report-pdfs-draw-the-screens-sheet-at-its-own-scale.md) (a report PDF draws its screen's sheet from the screen's own payloads, at the sheet's scale)
- Deciders: Claude, for PROTO-171 (the downloaded report PDF matches the on-screen report) and PROTO-172 (report PDFs from the templates are laid out like a designed report)
- Backlog: PROTO-171, PROTO-172

## Context

On 2026-11-25 the owner found that both report PDFs looked unlike the app. The signed clinical report downloaded as a plain "Clinical report" list with raw codes such as "na", while the screen showed a surgical pathology report built by `documentOf` in `apps/web/src/screens/clinical-report/model.ts` and drawn by `ReportDocument` in `packages/ui`. The evaluation report and the template samples printed in Typst's default serif with boxed tables that hugged the top left corner. Both PDFs come from Typst ([ADR 0083](0083-typst-for-report-pdfs.md), Typst for report PDFs), but each wrote its own page setup, and both compiled with `ignore_system_fonts` and no font files, so Typst fell back to its embedded serif.

## Options considered

1. Render the clinical PDF in the browser from the `ReportDocument` component, by printing or with a client PDF library. One layout, but a signed record would be drawn from whatever the client holds, the bundle grows, and the evaluation report would still need Typst.
2. Let the web post its document model to the API for rendering. The PDF of a signed report would then carry client content, which a signed record must not.
3. Build the same document model on the server from the signed version, and draw every report PDF with one shared Typst layout that copies the screen's numbers.

## Decision

Option 3.

- `parfocal_api.report_style` holds the one layout: IBM Plex Sans, the app's font, shipped as TTF files in `parfocal_api/fonts` and passed through `compile_options()`, the screen's 40pt and 36pt margins on A4, 11pt body and 9pt muted text, the heading block, the two-column metadata grid, the ruled section heading and ruled full-width tables. Every Typst compile uses `LAYOUT` and `compile_options()`.
- `parfocal_api.clinical_document.document_of` builds the `ReportDocumentModel` of `packages/ui/src/lib/report-document.ts` from the signed version, and the PDF draws it with the layout. Dates are in UTC, because the server does not know the reader's time zone.
- `packages/test-fixtures/report-document.json` pins the two models together. A web test runs `assembleReport` and `documentOf` on it, an API test runs `document_of`, and both must equal the same expected model. A change to either side fails one of them until the other follows.

## Consequences

- A new report PDF, or a change to the screen report, changes the shared layout or the fixture, not a private page setup.
- The fonts are converted from `packages/tokens/fonts` with fontTools (latin and latin-ext merged per weight) and committed with their OFL licence. A new weight is converted the same way.
- The screen shows dates in the reader's time zone and the PDF in UTC, so a report signed near midnight can show a different day in each.
