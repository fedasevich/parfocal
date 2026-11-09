# Data processing agreement template

A template for the agreement under GDPR Article 28(3) between a workspace (the controller) and Parfocal (the processor), written for SEC-021 (GDPR documentation). It is not legal advice. TODO: counsel reviews it before the first tenant with real patient data signs it.

Simulated check, no such person took part. Agents wrote this page where counsel would write or review it ([agent-stand-in-records.md](../project/agent-stand-in-records.md)).

Fields in square brackets are filled per tenant.

## Parties

- Controller: [legal name, address, registration number, contact for data protection].
- Processor: Yurii Fedas, trading as Parfocal, contact for data protection `support@parfocal.eu`. TODO: the postal address and registration number, or the company once it exists (SEC-030, legal review before the first real tenant).

## 1. Subject, duration and nature

1.1 The processor provides the Parfocal platform for reviewing AI results on whole slide images, as described in the service terms of [date].

1.2 This agreement runs as long as the processor holds personal data for the controller, and ends with the return or deletion in section 9.

1.3 The processing is hosting, storing, displaying, running AI models on, exporting and deleting the data the controller's users put into their workspace.

## 2. Data and data subjects

2.1 Data subjects: patients whose tissue is on the slides, and the controller's staff and guests who use the workspace.

2.2 Categories: slide images and their labels, specimen details, patient identifiers in clinical projects (name, record number, birth date, sex, age), AI results, review decisions, notes and messages, and user identity and activity. The column list is in the [data map](../reference/data-map.md).

2.3 Special categories: health data under Article 9.

2.4 The controller decides whether a project is de-identified or clinical, and puts patient identifiers only into clinical projects.

## 3. Controller's duties

3.1 The controller has a legal basis under Articles 6 and 9 for the processing and records it.

3.2 The controller informs patients under Articles 13 and 14. A notice template can be provided on request.

3.3 The controller keeps a person responsible for every decision about a patient. AI results in Parfocal are proposals that a person reviews ([DPIA](dpia-ai-results-review.md), Article 22).

## 4. Processor's duties

4.1 The processor processes the data only on the controller's documented instructions, which are this agreement and the controller's use of the platform, unless Union or Member State law requires otherwise, in which case it informs the controller first where the law allows.

4.2 Everyone at the processor who can reach the data is bound to confidentiality.

4.3 The processor takes the measures of Article 32 listed in Annex 2.

4.4 The processor helps the controller answer data subject requests. The platform gives a personal data export for members and patients, erasure of patients by project owners and erasure of members by platform operators ([ADR 0090](../adr/0090-access-export-and-erasure.md)).

4.5 The processor helps the controller with security, breach notification, impact assessments and prior consultation under Articles 32 to 36.

4.6 The processor notifies the controller of a personal data breach without undue delay and within [24] hours of becoming aware of it, with the facts Article 33(3) lists as far as they are known. The owner accepted 24 hours on 2026-11-04, and counsel may change it in SEC-030. The [incident response runbook](incident-response.md) uses 24 hours ([ADR 0186](../adr/0186-incident-response-and-breach-notification.md)).

4.7 The processor makes available the information needed to show compliance and allows audits by the controller or an auditor it mandates, with [30] days notice, at most once a year unless a breach or a regulator requires more.

4.8 The processor tells the controller at once if an instruction appears to infringe data protection law.

4.9 The processor keeps a record of processing under Article 30(2) ([records-of-processing.md](records-of-processing.md)).

## 5. Subprocessors

5.1 The controller gives general authorisation for the subprocessors in Annex 3.

5.2 The processor informs the controller of an added or replaced subprocessor at least [30] days ahead. The controller may object on reasonable data protection grounds, and if the parties cannot agree, the controller may end the service.

5.3 The processor binds each subprocessor to the same data protection duties in a written contract and stays liable for it.

## 6. Transfers

6.1 Personal data is transferred outside the EEA only under Chapter V, through an adequacy decision or standard contractual clauses with the needed supplementary measures.

6.2 The current locations are in Annex 3. TODO: before real patient data, the processor pins EU regions or completes the SCCs and a transfer impact assessment for each subprocessor outside the EEA.

## 7. Retention

7.1 The controller sets the retention of deleted records and of the audit log for its workspace ([ADR 0089](../adr/0089-retention-purge-and-audit-re-anchor.md)). By default nothing is purged.

7.2 Legal holds set by the controller stop every purge.

## 8. Requests from authorities

8.1 The processor does not disclose data to an authority outside the EU unless Union or Member State law requires it. It informs the controller of any request unless the law forbids that, and challenges requests that are not lawful.

## 9. End of the service

9.1 At the end, the controller may export its data within [30] days. The processor then deletes it, including from its subprocessors, and confirms deletion in writing. Backups expire on their schedule. TODO: SEC-014 (backups) states the backup period.

## 10. Liability and law

10.1 [Liability terms per the service terms.] [Governing law and court.]

## Annex 1: description of processing

Sections 1 and 2 above.

## Annex 2: technical and organisational measures

- Tenant isolation by row level security on every workspace table, tested through the connection pooler.
- Patient identifiers sealed with a per workspace key, searched through blind indexes.
- Encryption in transit and at rest.
- A hash chained, append only audit log of access and changes.
- Sign-in through an identity provider with MFA, sessions held server side with an HttpOnly cookie, idle lock and session lifetime per workspace.
- Roles per workspace and project, emergency access with a recorded reason.
- Logs, traces and error reports scrubbed to an allow-list, and nothing exported outside production.
- Rate limits at the edge and in the API, security headers with a per request content security policy.
- Retention with legal hold, access export and erasure.
- The full mapping is in [controls.md](controls.md).

## Annex 3: subprocessors

The list in [subprocessors.md](subprocessors.md) on the date of signing.
