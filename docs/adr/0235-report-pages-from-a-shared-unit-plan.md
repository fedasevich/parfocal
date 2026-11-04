# 0235. The report page and the PDF split blocks into pages by one shared unit plan, and a signed report keeps its layout through its pinned template version

- Date: 2026-11-04
- Status: Proposed
- Deciders: Yurii Fedas (standing approval), proposed by the agent building EVAL-008 (report from template blocks)
- Backlog: EVAL-008 (report from template blocks), touches ADJ-004 (sign-off as a soft lock), EVAL-009 (arrange one report) and EVAL-010 (PDF preview)

## Context

EVAL-008 asks the report page to split the blocks into pages the way the PDF does, and a signed report to keep its layout after the template changes. Typst lays out the PDF on the server ([ADR 0083](0083-typst-for-report-pdfs.md)) and React draws the page in the browser, so neither can ask the other where a page ends. ADJ-004, which stores evaluation versions, is not built yet ([ADR 0231](0231-evaluation-exports-and-their-checksum.md)).

## Options considered

For the pages:

1. Let Typst break pages on its own and draw the web page as one long sheet. The page list and the PDF would disagree on what is on which page.
2. Render the PDF first and send its page breaks to the browser. Needs Typst on every page view and a round trip on every change while arranging.
3. One small plan that both sides compute the same way: each block kind has a height in units, a page holds a number of units set by the paper, orientation and text size, two half-width blocks share a row, and a page break starts a new page. The PDF writes a page break exactly where the plan says. A block taller than its estimate can still overflow onto an extra PDF page.

For the signed layout:

1. A new column on `review_tasks` with a copy of the block list and format, written at sign-off. Needs a migration and a sign-off flow that ADJ-004 owns.
2. Rely on the pin. A task records its template and version ([ADR 0120](0120-study-templates-are-workspace-rows-and-tasks-only-pin-them.md)), a version never changes once written, and nothing changes a task's pin after it is created. So the layout a task was signed with is the layout it renders.

## Decision

Pages option 3 and signed layout option 2.

- The plan lives in `parfocal_common.report_layout` and in `packages/api-client/src/draft/report-layout.ts`. Both are checked against the same cases in `packages/test-fixtures/report-layout.json`, and the PDF tests check that every planned block prints on its planned page.
- The closing part (decision counts and signature) follows the last block when it fits, and each appendix gets its own page.
- No migration. A signed task renders from its pinned version.

## Consequences

- Changing a unit or a capacity means changing both implementations and regenerating the shared cases. The tests fail until both agree.
- EVAL-009 (arrange one report) lets a task change its own layout. It then has to store the arrangement on the task, and from that point ADJ-004 has to copy the arrangement into the evaluation version at sign-off, as [ADR 0097](0097-report-templates-built-from-blocks.md) says.
- A very long table can push the PDF onto one more page than the plan. The block order stays the same.
