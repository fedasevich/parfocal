# Result: every report PDF against its on-screen report

- Date: 2026-11-28
- Backlog: PROTO-219
- Kind: baseline
- Commit: 046b8846 for "before", the PROTO-219 branch for "after"
- Environment: MacBook, macOS 15.8.1, Google Chrome through Playwright at device scale 2, time zone Europe/Prague, typst-py 0.15, fake API dev server on port 5197
- Data: the fake RT-14 evaluation report at `?scene=report` (synthetic, no PHI), saved as `packages/test-fixtures/evaluation-report-screen.json`

## Question

Does each report PDF show what its on-screen report shows, with the same sections, labels, values, order and look? The owner found on 2026-11-28 that the RT-4 evaluation PDF did not, and asked for every report PDF to be rechecked.

## Method

1. A Playwright script opened `/tasks/<RT-14>/evaluation?scene=report` on the fake API at 1440 x 1800, loaded it twice so the optional Plex faces were cached and drawn, and read the props of each `ReportPage` from the React fiber, the text of each sheet in DOM order with its computed font, and the box of every element. It saved an element screenshot of each `[data-slot="report-sheet"]`, 620 x 877 CSS px, so 1240 x 1754 px.
2. The props became the fixture. The "before" PDF is what `render_report` drew at commit 046b8846 from the same evaluation, blocks and format. The "after" PDF is what `paper_of` and `paper_layout.typ` draw from the fixture.
3. Both PDFs were drawn to PNG at 144 × 620 / 595.28 ppi, so one sheet pixel of the screen is one PDF pixel, and compared with `compareFrames` from `@parfocal/golden-images` at the `shot` tolerance (channel delta 24). A second count looks only at ink, the pixels that are dark in either image.
4. pypdf read the text of each PDF, and its baselines were set against the screen's, taken as the text box top plus 1.025 times the font size.
5. The second half found that a reload does not make the screen draw Plex. The app loads its faces with `font-display: optional`, so on the dev server Chrome keeps the system font for the page even when the faces report `loaded`: the synoptic label "Total number of sentinel lymph nodes examined:" measured 253.7 px, the system font's width, not Plex's 240.2 px. Every capture of the second half therefore re-adds the page's own `@font-face` rules with `font-display: block` and waits for them, as the PROTO-171 result did, and the evaluation sheets were captured again the same way. Numbers marked "re-measured" are against those Plex captures.

## Results

### Every path that renders a report PDF

A grep of `apps/api/src`, `apps/web/src`, `apps/edge/src` and `workers` for `typst`, `application/pdf`, `printPages`, `reportpdf` and `.pdf` found these, and no others.

| Path | Server code | Screen it shows | Reached from the web |
|---|---|---|---|
| Task evaluation report, `exportTaskEvaluation` report.pdf | `evaluation_exports.task_report`, `evaluation_paper`, `paper_layout.typ` | `ReportPage` in `report-pages.tsx` | Evaluation screen download and the PDF preview's download |
| Evaluation PDF preview, `previewTaskEvaluation` | the same `task_report`, compiled to SVG | the same | `TaskPdfOverlay` in `pdf-overlay.tsx` |
| Sign-off window's ticked PDF export (PROTO-154) | the same `exportTaskEvaluation` report.pdf | the same | `downloadExport` in `sign-off-screen.tsx` |
| Study template samples, the four template preview operations | `template_sample`, `sample_layout.typ` | `ReportPages` in `report-editor-pages.tsx` | `TemplatePdfOverlay` and `SavedTemplatePdfOverlay` from the template editor, the template library and the new task's template step |
| Clinical case report, `downloadCaseReportPdf` | `clinical_document.pdf_of` | `ReportDocument` through `documentOf`, in `report-screen.tsx` and `cosign-screen.tsx` | "Download PDF" on both screens |
| Annotate task report, `exportTaskEvaluation` report.pdf on an annotate task | `evaluation_exports.annotate_report`, `report_template.render_report` | none | nothing: `getEvaluationReport` refuses annotate tasks, the annotate sign-off has no export, and no screen calls `getTaskAiChanges` |

The clinical report screen's own "Preview of the report" overlay draws `ReportDocument` in the browser, not a PDF, so it is the screen side of the clinical row.

### Annotate task report

The annotate task report PDF exists only as an API path. No screen shows an annotate task's report, so there is nothing to draw it from or to measure it against, and it stays on `render_report` with its "How the experts changed the AI" tables. It is left for the owner whether it should get a screen or be drawn with the evaluation sheet's letterhead.

### Task evaluation report (`exportTaskEvaluation` report.pdf, the `previewTaskEvaluation` pages and the sign-off window's PDF export)

What differed before: a running header on page 1, "Signed off 15/10/2026" in another date format, a Project, Task and Checksum block without the lab, Model, Slides, Reviewers or Template, Results as a Measure and Value table, letterspaced section headings, cell types as a sensitivity table, reasons and opinions as tables, a Decisions table the screen does not have, and no "Left open on purpose" or signature sentence.

| Measure | Before | After |
|---|---|---|
| Screen texts found in the PDF text, of 177 | 71 | 176 |
| Sheets | 3 | 3 |
| Differing pixels, page 1 | 7.73% | 3.63% |
| Differing pixels, page 2 | 3.98% | 3.56% |
| Differing pixels, page 3 | 1.93% | 2.07% |
| Differing ink pixels, page 1 | 98.8% | 60.9% |
| Differing ink pixels, page 2 | 99.5% | 90.8% |
| Differing ink pixels, page 3 | 99.8% | 89.6% |
| Text baselines more than 0.6 px from the screen's, after | | 5 of 177 |
| Re-measured against Plex, differing pixels, pages 1 to 3, with the 0.38 px tracking | | 9.23%, 3.42%, 1.81% |
| Re-measured against Plex, differing pixels, pages 1 to 3, without tracking | | 2.30%, 2.22%, 1.17% |
| Re-measured against Plex, differing ink, pages 1 to 3, with the 0.38 px tracking | | 95.5%, 88.0%, 80.4% |
| Re-measured against Plex, differing ink, pages 1 to 3, without tracking | | 41.3%, 64.0%, 43.2% |

The one text not found as a whole is the change row, which the screen splits into five DOM nodes. The test finds every screen text in order with nothing left over but the checksum line.

The baselines that still differ are the four matrix column names, 2.5 px low, and the change line on the right of the letterhead, 0.4 px. Page 1 lost more than half its differing ink when the letterhead rule, the facts rule and the tile borders were made to take space as CSS borders do. Most of what remains is glyph placement along a line. Chrome on this Mac draws Plex Sans about 0.38 px wider per character at 7.5 to 11 px and 0.18 px at 15 px than Typst does, measured over 60 strings, so the layout adds that as tracking. Without it the lab name and the letterhead lines did not wrap where the screen wraps them. Small offsets of a glyph along a line fail most ink pixels even when the text sits where the screen puts it, which is why pages 2 and 3, mostly tables, still show about 90%.

Re-measured: the 0.38 px was the system font, not Plex. With Plex drawn, Typst's Plex Sans widths match Chrome's with no tracking, a mean error of -0.02 px over 87 strings of the template editor and at most 0.85 px, while 0.38 px of tracking makes them 3.35 px too wide on average and up to 23 px. The tracking is now 0, which halves the differing ink on every page, and all 177 screen texts are still found in order.

### Study template samples (`previewStudyTemplate`, `downloadStudyTemplatePreview`, `previewSavedStudyTemplate`, `downloadSavedStudyTemplatePreview`)

The template editor does not draw `ReportPage`. It draws `ReportPages` in `packages/ui/src/components/report-editor-pages.tsx`: a sheet 520 CSS px wide with 28 px padding, text at 9, 11 or 13 px by the text size setting, line height 1.5, the "Parfocal" and "Sample project · sample numbers" letterhead with the filled title and subtitle, a running header on later pages, the blocks in a two column grid with fixed sample bodies, and a footer with "Sample · not a real evaluation" or the signature line and the page number. The capture opened `/admin?section=templates` on the fake API, opened CAMELYON rounds in the editor and gave it a draft with every block kind, two half width pairs, a page break, a hidden title and an empty text block (saved as `packages/test-fixtures/template-sample-screen.json`), then took each `section[data-page]` at device scale 2, 1040 x 1471 px.

What differed before: the samples printed the evaluation layout of `ReportData` with other sample numbers (0.88, 0.83, 0.85 where the editor shows 0.86, 0.81, 0.77), a "CAMELYON rounds Evaluation version 1" running header, a Project, Task, Signed by and Checksum block, Results as a Measure and Value table, "Pick a slide for this figure." and "Pick a review task to compare with." where the editor shows sample bodies, the text block with its `{task}` placeholders unfilled, Decisions and Signature sections and an objects appendix the editor does not have, and five pages where the editor shows three.

| Measure | Before | After |
|---|---|---|
| Editor texts found in the PDF text, of 142 | 50 | 142 |
| Pages | 5 | 3 |
| Differing pixels, page 1 | 7.68% | 2.57% |
| Differing pixels, page 2 | 11.69% | 2.61% |
| Differing pixels, page 3 | 0.92% | 0.83% |
| Differing ink pixels, page 1 | 98.0% | 50.1% |
| Differing ink pixels, page 2 | 99.6% | 59.8% |
| Differing ink pixels, page 3 | 99.1% | 77.3% |
| Text baselines more than 0.7 px from the editor's, after | | 0 of 142 |
| Text starts more than 1 px from the editor's along the line, after | | 0 of 142 |

The samples are now drawn by `parfocal_api.template_sample`, a port of `ReportPages`, `SampleBody`, `filled`, `sampleValue` and `paginate`, with `sample_layout.typ` at the editor sheet's scale, one px being the page width over 520. The test finds every editor text in order with nothing left over but the "DRAFT" watermark, which the editor draws as a CSS `::after` and so has no DOM text. The checksum line is gone from the samples, because the editor shows none. Table columns split their width in proportion to each column's widest text plus its padding, as the browser's automatic table layout does, and start within 0.92 px of the editor's. "Cohen's κ" falls back to Libertinus Serif for the κ, as in the evaluation PDF, because the shipped Plex Sans files carry Latin only.

### Clinical case report (`downloadCaseReportPdf`, from `report-screen.tsx` and `cosign-screen.tsx`)

Re-measured on the signed scene of the Showcase sentinel node case S26-04812 with Plex drawn: the `model` prop of `ReportDocument` and the text of `[data-slot="report-document"]` were saved as `packages/test-fixtures/clinical-report-screen.json`, with the section headings in capitals as the CSS `uppercase` shows them, and `clinical_document.pdf_of` drew the PDF from that model. The co-sign screen shows a review form, not the report sheet, and its "Download PDF" fetches the same version 1 PDF through the same endpoint, so the signed report sheet is its screen too.

| Measure | Now |
|---|---|
| Screen texts found in order in the PDF text, of 57 | 57, nothing extra |
| Differing pixels, the 1494 px rows both images have | 5.76% |
| Differing ink pixels, same rows | 69.1% |
| Text baselines more than 0.7 px from the screen's | 1, "Page 1 of 1" |
| Text starts more than 0.6 px from the screen's along the line | 0 |

Nothing needed fixing. The one moved text is the page line, which the screen prints at the foot of a sheet 746 px tall and the PDF at the foot of the A4 page, as the PROTO-171 result recorded. Against a capture in the system font, as a plain reload gives, the same PDF differed in 8.88% of pixels and 91.8% of ink, and the long synoptic labels wrapped on screen but not in the PDF, which is what a reader whose browser kept the system font sees.

## Interpretation

- The evaluation PDF is now drawn from the same payloads the screen uses (`getEvaluationReport`, `getTaskEvaluation`, `getDisagreementQueue`, `getReviewTask` and member names), through a Python port of `ReportPage` in `apps/web/src/screens/evaluation/report-pages.tsx`, and laid out at the sheet's own scale: 620 CSS px across an A4 page, 10 px text at line height 1.4.
- The checksum is kept as one footer line under the page footer, the only text the screen does not show.
- Dates follow the reader's zone through `?zone=`, as the clinical report does since ADR 0447 (report PDFs print the reader's time zone).
- The report PDFs draw Plex with no added tracking, which is what Chrome draws once Plex is in use. A reader whose browser kept the system font under `font-display: optional` sees a wider screen than the PDF. That is a property of the screen's font loading, not of the PDFs.

## Follow-ups

- The study template samples, the clinical report and the annotate task report are measured in the next sections of this file as their paths are done.
- The lead checks on app.parfocal.eu that each deployed download matches its preview, RT-4 included.
