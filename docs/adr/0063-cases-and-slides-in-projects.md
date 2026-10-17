# 0063. Cases and slides live in projects, a case is optional, and the hospital case columns are gone

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-004 (rework cases for projects), supersedes [ADR 0036](0036-case-data-model.md) for CASES-001 (patient and case model)

## Context

[ADR 0036](0036-case-data-model.md) modelled a hospital case: a required patient, an accession number, priority, due time, assignee, requester and encrypted clinical note and question, with specimens, blocks and slides under it. [ADR 0062](0062-project-model.md) puts every case and slide in a project, makes the case optional and names the tables. This ADR records how ADAPT-004 built that.

## Options considered

1. Add new migrations that create `projects` and alter `cases` and `slides`. Every existing local database would migrate, but the chain would build the hospital shape first and then take it apart.
2. Create `projects` and `project_members` in migration `0012`, ahead of `cases`, and give `cases` and `slides` their new shape there. The file is renamed `0012_projects_and_cases.py` and keeps revision `0012`. This follows [ADR 0054](0054-hospital-code-inventory-and-revert-order.md), because no shared database ran it.

## Decision

Option 2.

- `projects` has `id`, `tenant_id`, `number` (1 to 9999, unique per workspace), `name`, `privacy_mode` (`de-identified` by default, or `clinical`), timestamps and `deleted_at`, with unique keys on (`id`, `tenant_id`) and (`id`, `privacy_mode`).
- `project_members` has `tenant_id`, `project_id`, `user_id` and `role` (`owner`, `reviewer` or `viewer`), keyed on the project and person and pointing at the membership with `ON DELETE CASCADE`. Nothing writes it yet. PROJ-001 and PROJ-003 do.
- `cases` has `project_id`, an optional `patient_id`, `label` (the case ID, up to 100 characters, unique within the project, still `phi`), `source` (`manual` or `upload`), the creator, and the `service` and `is_draft` columns that ADAPT-005 removes. Priority, due time, assignee, requester and the clinical note and question are gone.
- `slides` has `project_id`, an optional `case_id`, an optional block, a `label` (unique within the case, or within the project for loose slides through a partial unique index), the barcode (unique per project), stain and level. A key on (`case_id`, `project_id`) keeps a slide in its case's project, and a check refuses a block without a case.
- `POST /api/cases` takes `project_id` and `label`, and the patient is optional. A patient or `patient_id` in a de-identified project is refused with 400 `de-identified-project`, and a project outside the workspace answers 404. A taken label answers 409 `case-label-taken`. `listCases` filters by `project_id`, and cases return `project_id` and `label`, with slides carrying their label.

## Consequences

- The patient in a case is still a workspace patient. ADAPT-011 moves patients into their clinical project and makes the database refuse one in a de-identified project, as ADR 0062 says.
- Slides have no API yet. The loose slide and the label rules are tested in the database, and INGEST and RSET tasks add the endpoints.
- The tests make projects through `seed_project` in `case_support.py` and `make_project` in `workspace_support.py`.
- Encrypted clinical text no longer exists, so `seal_field` and `open_field` have no caller in the API. They stay in `parfocal_api.identifiers` for patient fields.
