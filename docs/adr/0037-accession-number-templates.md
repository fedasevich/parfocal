# 0037. Accession numbers from a per-workspace template with a counter per prefix and year

- Date: 2026-10-14
- Status: Superseded by 0058
- Deciders: Yurii Fedas
- Backlog: CASES-004, CASES-013, CASES-007, CASES-008

## Context

CASES-004 (accession number rules) asks for a per-workspace format and uniqueness, tested for format validation and collisions. The UX kit shows numbers like `S26-04830` and says the number is shown before a new case uses it. Cases from the LIS arrive with the LIS's number, and cases made in the app need a number of their own that never clashes with one the LIS sent.

## Options considered

1. A regular expression per workspace. Validates imports, but cannot generate numbers.
2. A small template language: `{prefix}`, `{yy}` or `{yyyy}`, and `{seq:N}`, with capital letters, digits, `-`, `.` and `/` between them. The same template renders new numbers and compiles to a pattern for imports.
3. A database sequence per prefix. Fast, but sequences ignore rollbacks, do not reset per year, and cannot skip numbers the LIS already used.

## Decision

Option 2, with numbers handed out from a counter row per workspace, prefix and year.

- The default is `{prefix}{yy}-{seq:5}` with the prefix `S`, which produces the kit's `S26-04830`. A template needs exactly one prefix, one year token and one sequence of 3 to 8 digits, and its numbers may not exceed 40 characters.
- Allocation increments the counter with an upsert in the case's own transaction, so concurrent cases never share a number and a rolled-back case frees nothing. A number that already exists in the workspace, for example from the LIS, is skipped. A full range answers 409 `accession-range-full`.
- An imported number must match the template and be unused, or it is refused with `accession-format` or `accession-taken`.
- `GET /api/tenant/accession-format` shows the template, prefixes and the next number per prefix to every member. `PUT` needs `lab-setup` and is audited.

## Consequences

- The year is the database server's UTC year. TODO: a workspace time zone setting, when one exists, should decide the year near midnight on 31 December.
- The shown next number is a preview. Another case may take it first, so the screen must show the number the case actually received.
- CASES-013 (case creation API) calls `allocate_accession`, and CASES-007 and CASES-008 (imports) call `check_imported_accession`.
