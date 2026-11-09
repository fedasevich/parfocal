# XXXX. The PDF preview shows the SVG pages the Typst worker makes, and the template preview fills a sample project's numbers on the server

- Date: 2026-11-09
- Status: Proposed
- Deciders: Yurii Fedas (standing approval), proposed by the agent building EVAL-010 (PDF preview)
- Backlog: EVAL-010 (PDF preview), builds on EVAL-008 (report from template blocks) and STACK-035 (PDF generation for reports)

## Context

The preview must show the file the export would download. The report page draws its own React pages from the shared unit plan ([ADR 0235](0235-report-pages-from-a-shared-unit-plan.md), the report page and the PDF split blocks by one plan), so those pages can differ from what Typst prints, for example when a long table overflows onto one more page.

## Options considered

1. Keep drawing the React pages in the preview. It is instant, but it is a picture of the plan and not of the file.
2. Send the PDF to the browser and show it with a PDF library. It adds a large script to the first page bundle, which is near its budget, and every browser draws it differently.
3. Let the API compile the same Typst source to SVG, one string per page, and show each page as an image. The preview and the download come from one source and one compile, with no new script.

## Decision

Option 3.

- `GET /api/review-tasks/{task_id}/evaluation/preview` returns the file name, paper, orientation, page count and one SVG string per page. It uses the same permission, the same hidden-evaluation rule and the same report builder as the PDF export, so the page count equals the PDF page count.
- `POST /api/study-templates/preview` takes a template draft (name, blocks, format) and fills it with fixed sample numbers, so no project data is read. `POST /api/study-templates/preview/pdf` returns the same sample as a file for Print and Download. Both need the report-templates permission.
- The browser shows each page as an image from a `data:` URL. An image cannot run scripts, so the SVG needs no sanitising.
- The viewer is a lazy chunk, loaded only when someone opens a preview.
- The new-task template step, the template list and the template editor all use the template endpoint. The report page uses the task endpoint.

## Consequences

- A preview costs one Typst compile on the API, the same cost as a download.
- The sample numbers in the template preview are made up for layout and are labelled "sample numbers" in the viewer.
- The preview of an arrangement that is not saved yet (EVAL-009, arrange one report) can use the template endpoint with the arranged blocks.
