# XXXX. Report PDFs print the reader's time zone and lay out text in the screen's line box

- Date: 2026-11-28
- Status: Accepted, amends [ADR 0443](0443-one-typst-report-layout-for-every-pdf.md) (one Typst report layout for every PDF)
- Deciders: Claude, for PROTO-171 (the downloaded report PDF matches the on-screen report)
- Backlog: PROTO-171

## Context

ADR 0443 drew the signed report PDF in UTC because the server did not know the reader's time zone. The second walkthrough on 2026-11-26 found the preview saying "Reported 23 Nov 2026, 22:17" and the PDF "21:17". On the same day the owner found that the PDF text crowded together. The standards lines touched, synoptic rows had no gap, and a wrapped label took a taller second line than its row. Typst measured each line from cap height to baseline and added `leading` only inside a paragraph. A one-line grid row was therefore 7.7pt tall where the screen's 11px text at line height 1.5 takes 16.5px.

## Options considered

For the time zone:

1. Keep UTC and print a "UTC" label next to each time. The PDF would be honest but still differ from the preview the doctor just read.
2. Store a zone per workspace or per user and print in it. That needs a new setting and still differs from the preview when a reader travels.
3. Have the download link send the browser's IANA zone as `?zone=`, which is the same zone the preview formats in, and print in it. Without the parameter the PDF stays in UTC.

For the layout:

1. Tune `leading` and gutters until the PDF looks close.
2. Give every Typst line the CSS line box: `top-edge` and `bottom-edge` set from IBM Plex Sans's ascent and descent (1.025em and 0.275em) plus half of the 1.5 line height's leading, `par.leading` 0, then port the Tailwind gaps one to one.

## Decision

Option 3 for the time zone and option 2 for the layout.

- `GET .../clinical-report/versions/{number}/pdf` takes an optional `zone`. An unknown name is refused with 400 `unknown-time-zone`. `document_of` formats every date in that zone, and the API depends on the `tzdata` package so zone names resolve in a slim image.
- `parfocal_api.report_style` names every number of `ReportDocument` in `packages/ui`, and a test reads them back from its class strings: line height 1.5, 6pt between blocks, 2pt between rows, 12pt above and 2pt below a section heading, the 96pt label column, 8pt under the heading block, 16pt and 8pt above the signature. Rules are drawn as filled boxes, so a 1pt rule takes 1pt as a CSS border does. The heading rule is 1pt, because Chrome draws the screen's 1.5px border as 1px.

## Consequences

- The PDF prints the times the reader saw on screen. A PDF fetched without `zone`, such as by a script, prints UTC with no label, as before.
- Every baseline of the Showcase case report lands within 0.01pt of the screen ([result](../results/2026-11-28-report-pdf-against-the-screen.md)). The evaluation report and the template samples get the same line box, so their pages are a little taller.
- A change to the screen report's spacing fails `test_the_layout_numbers_are_the_screen_classes` until `report_style` follows.
