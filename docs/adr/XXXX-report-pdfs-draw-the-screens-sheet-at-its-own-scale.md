# XXXX. A report PDF draws its screen's sheet from the screen's own payloads, at the sheet's scale

- Date: 2026-11-28
- Status: Accepted
- Amends: [ADR 0443](0443-one-typst-report-layout-for-every-pdf.md) (one Typst report layout for every PDF)
- Deciders: Claude, for PROTO-219 (every report PDF shows what its on-screen report shows)
- Backlog: PROTO-219

## Context

ADR 0443 gave every report PDF one Typst layout with the clinical report's numbers, and pinned only the clinical PDF to its screen model. The evaluation report PDF kept its own content model, `ReportData` in `report_template.py`, which named, ordered and formatted things differently from `ReportPage` in `apps/web/src/screens/evaluation/report-pages.tsx`. The owner found on 2026-11-28 that the RT-4 PDF looked nothing like its screen. The evaluation screen draws a sheet 620 CSS px wide for A4 with 10 px text at line height 1.4, while the clinical screen draws 595 px with 11 px at 1.5.

## Options considered

1. Keep `ReportData` and restyle its Typst to look like the sheet. The labels, values and order would still come from a second model and drift again.
2. Print the screen in a headless browser on the server. Exact, but it needs Chrome in the API image and a signed-in render of a page.
3. Port the screen's page model to Python, feed it the same API payloads the screen fetches, and draw it with a Typst layout at the sheet's own scale.

## Decision

Option 3.

- `parfocal_api.evaluation_paper` is a port of `ReportPage` and its helpers in `numbers.ts`, `appendix.ts` and `counts-as-rule.ts`. `evaluation_paper_inputs` gathers `getEvaluationReport`, `getTaskEvaluation`, `getDisagreementQueue`, `getReviewTask` and member names, exactly what the screen reads.
- `paper_layout.typ` draws the paper model with one unit, `px`, equal to 595.28 / 620 pt, so every Tailwind number of `packages/ui/src/components/evaluation-report.tsx` is written as it is in the class string. CSS borders take space, so the Typst blocks add the border to their inset. Text gets the tracking Chrome on a Mac at device scale 2 was measured to add to Plex Sans, 0.38 px below 15 px and 0.18 px at 15 px.
- `packages/test-fixtures/evaluation-report-screen.json` holds the props and the DOM text of the fake RT-14 report. A test renders the PDF from those props and finds every screen text in order with nothing left over but the checksum footer line, and a second test reads the class strings back from the component.
- The PDF link and the preview send `?zone=`, as ADR 0447 (report PDFs print the reader's time zone) set for the clinical report.

## Consequences

- A change to `ReportPage` text needs the same change in `evaluation_paper`, and the fixture is captured again from the fake API. A changed class number fails `test_the_layout_numbers_are_the_report_sheet_classes`.
- The PDF follows the screen's English labels. The old `label_language` and locale switches of `ReportData` no longer reach the evaluation PDF, because the screen does not have them either.
- The template samples and the annotate report still use `ReportData` until they get the same treatment.
