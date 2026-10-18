# 0083. Report PDFs are rendered with Typst from the evaluation data

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: STACK-035, EVAL-000, EVAL-003, I18N-003

## Context

STACK-035 picks the PDF engine for reports. Since [ADR 0053](0053-ai-results-review-direction.md) the report is the evaluation report of a review task, exported as PDF with the checksum of its evaluation version (EVAL-003), next to a web report page (EVAL-002). The backlog default is Typst for deterministic, versionable templates, or WeasyPrint if templates must share HTML and CSS with the web preview. Workers run on Modal ([ADR 0003](0003-pilot-platform-architecture.md)).

## Options considered

1. Typst through the typst-py wheel. Fast, no system libraries, deterministic with a fixed timestamp, SVG preview from the same compile. Templates are written in the Typst language, not HTML.
2. WeasyPrint. HTML and CSS templates that a browser can show as they are, deterministic in the spike. About 20 times slower and needs Pango, HarfBuzz and system fonts in the image.
3. Headless Chromium printing. Matches the web page exactly, but adds several hundred MB and a browser start to every export worker.
4. ReportLab. Fine control, but layout written as drawing code.

## Decision

Option 1. A [spike](../results/2026-10-18-pdf-generation-spike.md) rendered a two-page evaluation report in 12 to 18 ms cold and 4 ms warm, with every checked string in the PDF text, and gave identical bytes across containers once `timestamp` was set.

- Templates live with the worker that renders them, take the evaluation as JSON through `sys_inputs`, and use only the fonts bundled with Typst or committed next to the template (`ignore_system_fonts=True`), so output does not depend on the machine.
- The PDF timestamp is the sign-off time of the evaluation version, so exporting the same version again gives the same bytes and checksum.
- The web report page (EVAL-002) stays a React page. It does not share the template, and both read the same evaluation JSON, so their content follows one source. The "preview" of the PDF itself is the SVG export of the same compile.

## Consequences

- EVAL-003 renders with typst-py in a worker and stores the PDF with its checksum. Its tests check the PDF text, as the spike did.
- EVAL-000 can name the PDF choice as confirmed.
- I18N-003 passes the locale into the template through `sys_inputs`.
- The typst-py wheel is 75 MB, which goes into the export worker image, not the API.
