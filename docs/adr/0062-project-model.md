# 0062. Projects hold optional cases, slides and result sets, need a membership to open, and own their patients

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: closes PROJ-000 (research check for projects), shapes ADAPT-004 (cases for projects), ADAPT-005 (case creation), ADAPT-010 (emergency access), ADAPT-011 (patients in clinical projects), PROJ-001 to PROJ-003, RSET-001 (result set model) and OBJ-001 (ID grammar)

## Context

[ADR 0053](0053-ai-results-review-direction.md) makes the project the unit of work. POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) "Data model" sets the hierarchy as project, then an optional case, then slide, then result sets, with loose slides directly in a project. Each project is de-identified (the default, no patient fields anywhere) or clinical (patient fields allowed, all optional, with logged access). Projects carry the roles owner, reviewer and viewer on top of the workspace roles of [ADR 0061](0061-researcher-reviewer-and-admin-roles.md).

Today `cases` belong to the workspace with a required patient, and `slides` require a case. `patients` belong to the workspace, with the MRN blind index unique per workspace ([ADR 0034](0034-blind-indexes-for-encrypted-patient-identifiers.md)). The code is throwaway, so no row has to survive ([ADR 0054](0054-hospital-code-inventory-and-revert-order.md)).

## State of the art

No new library is needed. SQLAlchemy Core and Postgres composite keys, partial unique indexes and check constraints cover the model. The check looked at how two open whole-slide and microscopy platforms structure the same thing.

| Platform | Hierarchy | Roles | Source |
|---|---|---|---|
| Cytomine | Project, then image, then annotation. One ontology (term list) per project, shareable between projects | Platform roles user, guest and admin. Project roles manager and contributor, and the creator becomes manager | [Cytomine user guide: projects](https://mont-cloud16.segi.ulg.ac.be/user-guide/project), [roles](https://mont-cloud16.segi.ulg.ac.be/user-guide/role), [ontology](https://mont-cloud16.segi.ulg.ac.be/user-guide/ontology) |
| OMERO | Project, then dataset, then image | Group permission levels private, read-only, read-annotate and read-write, plus group owners and administrators | [OMERO guide: data management](https://omero-guides.readthedocs.io/en/latest/introduction/docs/data-management.html) |

Both put access on the container rather than on each image, and both let the creator manage it. That matches project roles. Cytomine's per-project ontology matches the class taxonomy of PROJ-004.

## Options considered

### Who opens a project

1. Every researcher in the workspace sees every project, and project roles only add rights. This makes collaboration easy, but every researcher could read every clinical project's patients.
2. Opening a project needs a project role, for researchers too. The creator becomes owner and adds people. An admin sees the project list and its members for the admin page, but none of its slides or patients, except through emergency access in a clinical project (ADAPT-010).

### Where project access is enforced

1. Row-level security by project membership, using the `app.user_id` setting. It is the strongest guard, but it puts a membership join into every policy, and service accounts and admin listings would need their own paths.
2. Row-level security stays per workspace ([ADR 0020](0020-authorization-rls-scopes-and-rbac.md)), and the API filters by project through one helper, as it filters by role today. Isolation tests prove that the helper hides other projects.

### Where patients live

1. Patients stay per workspace and are linked to cases in any project. One person appears once, but a de-identified project could reach a patient through a shared row, and access logging could not say which project a read came from.
2. Patients belong to one clinical project. The same person in two projects is two rows. The database itself refuses a patient in a de-identified project.

## Decision

Opening a project needs a project role (option 2), project access is filtered in the API with row-level security per workspace (option 2), and patients belong to one clinical project (option 2).

| Table | Becomes | Task |
|---|---|---|
| `projects` (new) | `id`, `tenant_id`, `number` (unique per workspace, shown as P07, never reused), `name`, `privacy_mode` (`de-identified` by default, or `clinical`) and timestamps. A unique key on (`id`, `privacy_mode`) lets children pin the mode. PROJ-001 adds the colour, status, template and taxonomy | ADAPT-004, PROJ-001 |
| `project_members` (new) | `tenant_id`, `project_id`, `user_id` and `role` (`owner`, `reviewer` or `viewer`), keyed on the project and person and pointing at the membership, so removing someone from the workspace removes them from its projects. A workspace reviewer may hold only reviewer or viewer | PROJ-001, PROJ-003 |
| `cases` | Gains `project_id`. `accession` becomes `label`, the free-text case ID, unique within the project. `patient_id` becomes optional, and its key includes the project, so a case's patient is in the same project. The hospital columns go | ADAPT-004 |
| `specimens`, `blocks` | Kept, optional, under a case | ADAPT-004 |
| `slides` | Gains `project_id` and a `label` (such as A1, or the file name for a loose slide). `case_id` becomes optional. The label is unique within the case, or within the project for loose slides. `barcode` stays `phi` and becomes unique per project | ADAPT-004 |
| `patients` | Gains `project_id` and a `privacy_mode` column fixed to `clinical` by a check, with a key on (`project_id`, `privacy_mode`) to the project. The MRN blind index is unique per project | ADAPT-011 |
| `case_requests` | Kept for idempotent case creation | ADAPT-005 |
| `emergency_grants` | `case_id` becomes `project_id`, for clinical projects only | ADAPT-010 |
| `result_sets` (new) | One row per import or model run on one slide, with the model, version, source, kind (imported or run here) and counts. Immutable once written | RSET-001 |

A project leaves clinical mode only when it has no patients, and the key on the patient's mode refuses anything else. Changing a project to clinical is an admin action with a reason (PROJ-002).

The full object path is `P07/S26-04812/A1/T2·C145`, from the project number, case label, slide label and object ID. TODO: OBJ-001 (ID grammar) must give loose slides a path that cannot be mistaken for a case label.

## Consequences

- ADAPT-004 creates `projects` and `project_members` with the columns above, moves `cases` and `slides` under projects, and drops existing rows. PROJ-001 adds the API, the number allocation and the rest of the fields.
- The creator of a project becomes its owner. A researcher sees only the projects they are in, so the project list stays short and clinical patients stay with their project's people.
- PROJ-003 (project roles) owns the helper that turns the workspace grant and the project role into the effective grant, and the isolation test that hides other projects. Until then every member reaches every case, as ADR 0059 and ADR 0061 already say.
- ADMIN-004 (admin projects page) shows names, modes and members, never slides.
- ADAPT-011 moves patients under projects and rewrites the blind index uniqueness. [ADR 0034](0034-blind-indexes-for-encrypted-patient-identifiers.md) stays valid with a per-project scope.
