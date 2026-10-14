# Result: fhir.resources 8.3 for R4B and R5 on Python 3.14

- Date: 2026-10-14
- Backlog: STACK-040 (FHIR and HL7 libraries)
- Kind: spike
- Commit: cdd5768 (nothing in the repository changed, the spike ran in a scratch folder)
- Environment: Apple M4, macOS 15.8.1, CPython 3.14.7, fhir.resources 8.3.0 (released 2026-07-03), pydantic 2.14.1, installed with `uv run --no-project --with fhir.resources==8.3.0`
- Data: a made-up patient, order, specimen and report, no PHI

## Question

Does fhir.resources, the backlog default, work on our Python and pydantic versions, which FHIR releases does it offer, and how strictly does it validate? No budget exists. Parsing cost is compared with API request budgets of tens of milliseconds.

## Method

1. A script built and parsed `Patient`, `ServiceRequest`, `Specimen` and `DiagnosticReport` from both `fhir.resources.R4B` and the default package (R5), then timed 1,000 JSON round trips of the patient and took the mean. It ran twice.
2. A second script listed the release subpackages and fed a `ServiceRequest` without the required `status` and `intent`, and one with the priority code `whenever`, which is not in FHIR's priority value set. The patient check also tried the gender code `unknown-value`.
3. PyPI was read for the latest releases of fhir.resources and of `hl7` (python-hl7).

## Results

| Release | All four resources | Patient JSON round trip (µs), run 1 | Run 2 |
|---|---|---|---|
| R4B | Built and parsed | 64.0 | 60.5 |
| R5 | Built and parsed | 62.9 | 61.4 |

| Check | Result |
|---|---|
| Release subpackages in 8.3.0 | `R4B`, `STU3`, and R5 as the default. No plain `R4` |
| Missing required `status` and `intent` | Rejected |
| Priority `whenever` | Accepted |
| Gender `unknown-value` | Accepted |
| Latest `hl7` (python-hl7) on PyPI | 0.4.5, uploaded 2022-03-31 |

## Interpretation

- The library works on Python 3.14 with the pydantic line the repository already uses, and parsing costs tens of microseconds, so it never matters for request time.
- It checks structure and required fields but not code bindings, so our importers must check codes themselves.
- R4 itself is not packaged. Assumption, not checked here: R4B differs from R4 in medication-definition and subscription resources, not in the four resources above, so R4B models read and write R4 messages for this scope. CASES-007's contract tests must confirm it with real R4 sample bundles.
- python-hl7 has had no release since 2022. That is a risk only once an LIS needs HL7 v2.

## Follow-ups

- [ADR 0035](../adr/0035-fhir-r4-through-fhir-resources-r4b.md) records the decision.
- TODO: CASES-007 (FHIR import) adds the dependency and tests with real R4 bundles.
