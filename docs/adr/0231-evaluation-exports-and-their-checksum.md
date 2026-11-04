# 0231. Evaluation exports are rendered on request and carry a checksum of the evaluation JSON

- Date: 2026-11-04
- Status: Proposed
- Deciders: Yurii Fedas (standing approval)
- Backlog: EVAL-003 (exports), changes ADR 0083 until an export worker exists, ADJ-004 (sign-off) and EVAL-008 (report from template blocks) build on it

## Context

EVAL-003 exports a review task's evaluation as a PDF in the task's block order, the decisions per object as CSV with full object IDs, the objects as CSV, and the annotations as JSON and GeoJSON, each with the checksum of the evaluation version. [ADR 0083](0083-typst-for-report-pdfs.md) puts Typst in an export worker and not in the API. No export worker is deployed yet, and sign-off with numbered evaluation versions (ADJ-004) is not built, so there is no stored version or checksum to read.

## Options considered

1. Wait for ADJ-004 and an export worker on Modal before any export. Nothing ships, and EVAL-003 stays blocked on two other tasks.
2. Render every export in the API on request, and compute the checksum from the evaluation itself. Typst is an optional `pdf` extra of the API package, so the API image can leave it out and answer a PDF request with a 503 problem.
3. Store a frozen copy of each export when it is first asked for. Needs a table and storage, and the copy goes stale while the task is a draft.

## Decision

Option 2.

- One route, `GET /api/review-tasks/{task_id}/evaluation/exports/{kind}`, serves `report.pdf`, `decisions.csv`, `objects.csv`, `annotations.json` and `annotations.geojson`. It has the same access as the evaluation: project owners and viewers, never reviewers.
- The checksum is `sha256:` and the SHA-256 of the evaluation JSON with sorted keys and no spaces. Every export carries it in the `X-Parfocal-Evaluation-Checksum` header and inside the file: two columns on every CSV row, an `evaluation` object in the JSON, a `parfocal.evaluation` member on the GeoJSON collection, and a header line in the PDF.
- Until ADJ-004 stores versions, the version is 1 and the export says whether the task is signed off. A draft's checksum changes whenever its data does.
- The PDF lists the task's blocks in order: those of its study template version, or the detection template's when the task has none. Blocks that EVAL-008 has not built for the PDF yet say so in place. The decision counts close the report.
- The PDF timestamp is the sign-off time, or 2000-01-01 for a draft, so the same data gives the same bytes.

## Consequences

- CI installs every extra (`uv sync --all-packages --all-extras`), so the PDF tests run there.
- ADJ-004 replaces the computed version with the stored one and keeps the same checksum rule, so a signed export can be checked against what was signed.
- When an export worker is deployed, the PDF route hands rendering to it and the API drops the `pdf` extra, as ADR 0083 intended.
- EVAL-008 fills in the remaining block kinds in the same Typst source.
