# 0036. Case data model: patient, case, specimen, block and slide, with the kit's ten states and FHIR's codes

- Date: 2026-10-14
- Status: Superseded by 0063
- Deciders: Yurii Fedas
- Backlog: CASES-000, CASES-001, CASES-003, CASES-004, CASES-012, CASES-013, INGEST-001, IAM-010

## Context

CASES-000 (the research check for cases) must write the case data model as an ADR before CASES-001 (patient and case model) builds it. The UX kit's "Case lifecycle and data" page names the records (patient, case, specimen, block, slide and others that later tasks own) and ten states with who owns each. Patient name, MRN and birth date are already encrypted ([ADR 0034](0034-blind-indexes-for-encrypted-patient-identifiers.md)). FHIR R4 is the exchange format at the LIS boundary ([ADR 0035](0035-fhir-r4-through-fhir-resources-r4b.md)). Guests from another hospital see one case and never its patient ([ADR 0020](0020-authorization-rls-scopes-and-rbac.md)).

## Options considered

1. Shape. Mirroring FHIR resources one to one makes import trivial but forces FHIR's generic structures onto every screen. A model shaped by the kit's records, mapped to FHIR in the adapter, keeps queries simple.
2. Codes. Our own words for priority and sex would read well, but every import and export would need a translation table. FHIR's codes (`routine`, `urgent`, `asap`, `stat` and `male`, `female`, `other`, `unknown`) map one to one.
3. Clinical free text. Only the direct identifiers are required to be encrypted, but clinical notes and questions are written by people and often carry names, so they are encrypted with the same data keys. They are never searched.
4. Where slides hang. Under a block only, slides that arrive before their case is known would have nowhere to live. A slide always belongs to a case and optionally to a block, which also lets a slide move between cases (kit: "moves between cases keep its history").

## Decision

| Record | Holds | Notes |
|---|---|---|
| Patient | Encrypted name, MRN and birth date with blind indexes, sex (FHIR gender), age in years when no birth date is known | Never deleted. Merging is CASES-015 |
| Case | Patient, accession (unique per workspace), priority (FHIR request priority), due time, state, source (`lis`, `manual`, `upload`), assignee, encrypted clinical note and question, creator | State is one of the kit's ten. Folder arrives with CASES-003, accession rules with CASES-004 |
| Specimen | Case, letter (unique per case), type, site, laterality, procedure, collected and received times | Types and sites are free text until a coded list is chosen |
| Block | Specimen, number (unique per specimen), description | Levels and stains come with lab work |
| Slide | Case, optional block, barcode (unique per workspace), stain, level | Files, scans and their states are INGEST's |

- The states are `waiting-for-slides`, `waiting-for-ai`, `ready-to-review`, `in-review`, `waiting-on-others`, `report-drafted`, `with-supervisor`, `signed`, `amending` and `cancelled`. CASES-001 stores the state, CASES-012 (the case state machine) owns the transitions.
- Cases, specimens, blocks and slides are soft-deletable ([ADR 0019](0019-soft-delete-policy.md)). Cancelling is a state, not a deletion.
- Every table is tenant-owned with forced row-level security. A guest scope sees only its case and that case's specimens, blocks and slides through restrictive policies, and sees no patient rows at all.
- `GET /api/cases/{id}` returns the case with its patient, specimens, blocks and slides, guarded by "see cases". A guest gets the case without the patient.

## Consequences

- Import and export map our records to Patient, ServiceRequest, Specimen and DiagnosticReport in the adapter (CASES-007, CASES-010).
- Encrypted clinical text cannot be searched. TODO: CASES-009 (search API) confirms nobody needs to search it.
- The other records on the kit's page (AI runs, calls, threads, lab tasks, consults, report versions, messages) are added by the epics that own them.
