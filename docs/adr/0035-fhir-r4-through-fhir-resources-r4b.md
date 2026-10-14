# 0035. FHIR R4 on the wire through fhir.resources' R4B models, with codes checked by us and no FHIR server

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-040, CASES-000, CASES-007, CASES-008, CASES-010, REPORT-013

## Context

STACK-040 (FHIR and HL7 libraries) must fix the FHIR version (R4 or R5) and the resources in scope. Cases come from the LIS when there is one ([ADR 0023](0023-gap-review-backend-first.md)), CASES-007 imports FHIR bundles and CASES-010 sends signed reports out. The backlog default is fhir.resources for parsing and building Patient, ServiceRequest, Specimen and DiagnosticReport, with no FHIR server in v1.

## Options considered

1. FHIR version. R5 is the newest release, but hospital systems and national programmes mostly exchange R4, and R4 is what an LIS integration will meet first. R4 it is, with R5 added only when a partner asks.
2. Library. fhir.resources gives pydantic models for every resource, works on Python 3.14 and pydantic 2.14, and costs about 60 µs per patient round trip ([results/2026-10-14-fhir-resources-spike.md](../results/2026-10-14-fhir-resources-spike.md)). It packages R4B, not plain R4, and does not check code bindings. Hand-written pydantic models for four resources would avoid the dependency but miss the long tail of optional elements a real bundle carries. HAPI FHIR as an external server is a Java service to run for no current need.
3. HL7 v2. python-hl7 has had no release since 2022, and no LIS partner has asked for v2 yet.

## Decision

- FHIR R4 on the wire, read and written through `fhir.resources.R4B` models. The resources in scope are Patient, ServiceRequest, Specimen and DiagnosticReport, plus the Bundle that carries them.
- Our own enums check every code we act on (gender, priority, status), because the library accepts unknown codes.
- No FHIR server. FHIR is an exchange format at the LIS adapter, and Postgres stays the system of record.
- HL7 v2 is left out until an LIS needs it. TODO: CASES-008 decides on a v2 library then.

## Consequences

- CASES-007 adds fhir.resources 8.x to the API and must prove with real R4 sample bundles that the R4B models read them, because that equivalence is an assumption.
- Our internal model does not follow FHIR's shape. Mapping lives in the adapter, so the database is free to model what the screens need ([ADR 0036](0036-case-data-model.md)).
