# 0300. Per-object decisions live in `review_decisions`, and old audit names are mapped on read

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-024 (rename the old word to decision everywhere) and GUIDE-014 (use "decision" in code identifiers). Keeps [ADR 0072](0072-decisions-reasons-and-opinion-forms.md) (decisions, reasons and opinion forms).

## Context

The product says "decision" (agree, disagree or unsure), but the table, module, API paths, operation names and two audit actions kept an older word. The repository already has a `disagreement_decisions` table and many local variables named `decisions`, and the audit chain hashes each stored action, so a stored row can never be rewritten.

## Options considered

1. Name the table `decisions`. It is the shortest, but it collides with local variables and reads like the disagreement queue's table.
2. Name the table `review_decisions`, with the module `parfocal_api.review_decisions`. It says whose decision it is and collides with nothing.
3. Rewrite stored audit rows to the new action names. This breaks every hash after the first changed row.
4. Keep stored audit rows as they are and map the two old action names to the new ones when the audit list is read.

## Decision

Option 2 and option 4. Migration 0111 renames the table with its primary key, foreign keys, checks, indexes and update trigger, reading the names from the catalog, and its downgrade restores them. New audit entries use `review.object-decided` and `review.object-decision-cleared`. `parfocal_api.legacy_names` holds the two old action names and the old table name in one place. The audit list returns the new names and its action filters also match the old ones. The signed export keeps the stored names, so its hashes still verify. `scripts/guard_old_word.py` runs in `pnpm verify` and fails on a new use of the old word outside migration history, that module and the append-only memory docs.

## Consequences

An audit reader that recomputes hashes must use the export, not the list. Any later rename of a stored audit action follows the same pattern through `legacy_names`.
