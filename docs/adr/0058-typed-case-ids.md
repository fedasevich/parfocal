# 0058. Case IDs are typed or come from file names, and accession templates and counters are removed

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-006 (revert accession numbers), supersedes [ADR 0037](0037-accession-number-templates.md) for CASES-004 (accession number rules)

## Context

[ADR 0037](0037-accession-number-templates.md) gave each workspace an accession template such as `{prefix}{yy}-{seq:5}`, prefixes and yearly counters, and checked imported numbers against the template. That served a lab that issues its own case numbers. Since [ADR 0053](0053-ai-results-review-direction.md) a case is an optional group of slides in a research project. Its ID comes from the files a researcher uploads or is typed, and no workspace issues numbers.

## Options considered

1. Keep the templates as an optional feature for clinical projects. Nothing in the product asks for numbering, and the template check would refuse IDs that came from file names.
2. Remove the templates and counters, and take the ID as free text that must be unique.

## Decision

Option 2. `accession_formats`, `accession_counters`, `parfocal_api.accessions`, `getAccessionFormat`, `updateAccessionFormat` and the audit action `tenant.accession-format-changed` are gone, and migration `0013` was deleted ([ADR 0054](0054-hospital-code-inventory-and-revert-order.md)). `POST /api/cases` requires `accession`, trimmed, 1 to 40 characters, and answers 409 `accession-taken` when the workspace already has it. The `prefix` field is gone.

## Consequences

- Until ADAPT-004 (cases for projects) the ID is unique within the workspace. ADAPT-004 makes it unique within the project and renames the field to the case ID.
- CASES-024 (sorting dropped files into cases) fills the ID from file names.
- The column keeps its `phi` data class, because a hospital accession number pasted as an ID can identify a patient.
