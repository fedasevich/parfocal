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

## Results

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

The one text not found as a whole is the change row, which the screen splits into five DOM nodes. The test finds every screen text in order with nothing left over but the checksum line.

The baselines that still differ are the four matrix column names, 2.5 px low, and the change line on the right of the letterhead, 0.4 px. Page 1 lost more than half its differing ink when the letterhead rule, the facts rule and the tile borders were made to take space as CSS borders do. Most of what remains is glyph placement along a line. Chrome on this Mac draws Plex Sans about 0.38 px wider per character at 7.5 to 11 px and 0.18 px at 15 px than Typst does, measured over 60 strings, so the layout adds that as tracking. Without it the lab name and the letterhead lines did not wrap where the screen wraps them. Small offsets of a glyph along a line fail most ink pixels even when the text sits where the screen puts it, which is why pages 2 and 3, mostly tables, still show about 90%.

## Interpretation

- The evaluation PDF is now drawn from the same payloads the screen uses (`getEvaluationReport`, `getTaskEvaluation`, `getDisagreementQueue`, `getReviewTask` and member names), through a Python port of `ReportPage` in `apps/web/src/screens/evaluation/report-pages.tsx`, and laid out at the sheet's own scale: 620 CSS px across an A4 page, 10 px text at line height 1.4.
- The checksum is kept as one footer line under the page footer, the only text the screen does not show.
- Dates follow the reader's zone through `?zone=`, as the clinical report does since ADR 0447 (report PDFs print the reader's time zone).
- The tracking is an assumption about the reader's browser. On a screen at device scale 1 or on another platform Chrome may draw Plex narrower, and the PDF would then look slightly wider spaced than that screen.

## Follow-ups

- The study template samples, the clinical report and the annotate task report are measured in the next sections of this file as their paths are done.
- The lead checks on app.parfocal.eu that each deployed download matches its preview, RT-4 included.
