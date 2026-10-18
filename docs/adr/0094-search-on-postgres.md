# 0094. Search runs in Postgres under row-level security, with labels matched by ILIKE and patients by whole-word blind tokens

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: STACK-034, CASES-009, HOME-008, CMD-002

## Context

STACK-034 compares PostgreSQL full-text and trigram search, Meilisearch and OpenSearch, with Postgres as the default because everything is tenant-scoped and row-level security then covers search too. Since [ADR 0053](0053-ai-results-review-direction.md) search finds projects, cases, slides, object IDs and people, and patients only in clinical projects. Patient names are sealed and searchable only as whole words through blind indexes ([ADR 0034](0034-blind-indexes-for-encrypted-patient-identifiers.md)). The [spike](../results/2026-10-18-search-spike.md) measured 100,000 cases in one workspace.

## Options considered

1. Postgres under row-level security: `ILIKE` on labels and names, blind tokens for patients. Nothing new to run, and the policy that guards every other read guards search. The spike answered in 27 to 37 ms, but the trigram index is not used, so time grows with the table.
2. Postgres with a leakproof search function or a search table read through a security-definer function that applies the tenant filter itself, so a trigram index can be used. Faster at scale, but it moves tenant isolation for search out of the policies into code that must be kept right.
3. Meilisearch or OpenSearch. Fast typo-tolerant search, but another service to run and secure, a second copy of tenant data to keep in step and to erase, and isolation enforced only by the application.

## Decision

Option 1. It is under budget by a factor of three at the pilot's size and keeps isolation in one place.

- Projects, cases and slides match `ILIKE '%term%'` on their name or label, ordered by label, at most 20 per kind. Object IDs are parsed with `parfocal_common.object_ids` and looked up directly. People match by name within the workspace.
- Patients match only whole words through their blind tokens, in clinical projects the searcher may read.
- No trigram index is added, because row-level security keeps the planner from using it.
- Trigger to reopen: a workspace with more than 300,000 cases or slides, or search p95 above 100 ms on staging. Option 2 is then the first step.

## Consequences

- CASES-009 (search API) builds on this, with the latency test on seeded data the spike used.
- STACK-034's "Done when" asked for reports and partial patient names. Reports are not stored yet, and partial patient names are impossible by ADR 0034, so the spike covers cases, slides and whole-word patients, and the backlog line says so.
- TODO: rerun the spike on Neon when cloud work resumes.
