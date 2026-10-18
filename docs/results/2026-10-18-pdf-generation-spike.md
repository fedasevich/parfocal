# Result: Typst and WeasyPrint for the evaluation report PDF

- Date: 2026-10-18
- Backlog: STACK-035 (PDF generation for reports)
- Kind: spike
- Commit: `ff29a03` (no repository code was measured, the spike ran outside the repository)
- Environment: Docker Desktop on an Apple M4 (macOS 15.8.1), image `python:3.14-slim` (linux/arm64) with `libpango-1.0-0`, `libpangoft2-1.0-0`, `libharfbuzz-subset0` and `fonts-dejavu-core` from Debian, and `typst==0.15.0` (the typst-py wheel), `weasyprint==70.0` and `pypdf==6.21.1` from PyPI
- Data: a made-up two-page evaluation report: the Research output tag, task, project, version and checksum, six headline numbers, a confusion matrix, four disagreement reasons, 40 worst objects, the AI disclosure and a signature line. No PHI

## Question

Which engine should render the evaluation report PDF (EVAL-003)? It must be quick, give the same bytes for the same evaluation version (the export carries its checksum), run in a worker image on Modal, and offer a preview that shows the same content.

## Method

1. The same data went into a Typst template (`json(bytes(sys.inputs.at("data")))`, tables and a page footer with the version and page count) and into an HTML page with CSS paged media (`@page` margins and the same footer) for WeasyPrint.
2. A script rendered each six times in one process, timed every render with `time.perf_counter`, extracted the text of the last PDF with pypdf and checked that seven strings were present (task, checksum, signature, disclosure, the last object `T40`, "Cohen's kappa" and "1,903").
3. A second script rendered once per container in two separate containers and compared SHA-256 hashes. For Typst it also exported SVG pages.
4. Each configuration ran three times. The image size is from `docker image ls`, the package sizes from `du`.

## Results

| Engine | First render | Warm render (median of 5) | PDF size | Pages | Text found | Same bytes in one process | Same bytes across containers |
|---|---:|---:|---:|---:|---:|---|---|
| Typst 0.15 | 12 to 18 ms | 4 ms | 66,894 bytes | 2 | 7 of 7 | yes | only with `timestamp` set |
| WeasyPrint 70 | 218 to 219 ms | 79 to 89 ms | 18,588 bytes | 2 | 7 of 7 | yes | yes |

| | Typst | WeasyPrint |
|---|---|---|
| Python package on disk | 75 MB (compiler and default fonts in the wheel) | 3.1 MB |
| System libraries | none | Pango, HarfBuzz and fonts from the OS |
| Preview | SVG per page from the same compile, 6 to 7 ms for both pages | the HTML page itself |

The image with both engines and their libraries was 463 MB against 206 MB for `python:3.14-slim`. Without `timestamp`, two Typst runs gave different hashes, and with `timestamp=1760774400` they were identical.

## Interpretation

- Both produce correct text, and both are fast enough for an export. Typst is about 20 times faster and needs no system libraries, which keeps a Modal worker image simple.
- Typst output is deterministic once the creation timestamp is fixed. Using the evaluation version's sign-off time as the timestamp makes a re-export match the stored checksum. Assumption: with `ignore_system_fonts=True` and only the bundled fonts, the bytes also match across machines. Not measured across architectures.
- The Typst preview is the same compiled document exported as SVG, so preview and PDF cannot drift. The SVG draws glyphs as outlines, so its text cannot be compared, and the content match rests on the shared compile.
- Not run: Chromium printing through Playwright, because its browser adds several hundred MB to a worker image and a cold start per export, and ReportLab, because templates would be Python drawing code.
