# Compliance control matrix

This matrix maps the GDPR articles, the HIPAA Security Rule safeguards and the ISO/IEC 27001:2022 Annex A controls that matter for a health data platform to the tasks in [BACKLOG.md](../BACKLOG.md). It is the output of SEC-000.

## How to read it

- The task column lists backlog IDs, each followed by a few words that say what the task is.
- "Policy" means the control is organisational work with no software task. SEC-019, SEC-020 and SEC-021 hold the policy documents, so a Policy row is written there where one applies.
- "Gap" means no task covers the control yet. Every gap is listed at the end as a candidate task.
- A task marked "(partial)" covers only part of the control. The note says what is missing.
- Parfocal is a processor for its tenants' patient data, so most GDPR duties toward data subjects are met by helping the tenant, who is the controller. The notes say so where it matters.
- HIPAA specifications are marked (R) for required and (A) for addressable.
- The matrix cites control numbers and names only. It claims no certification and no audit result.
- Whether a task is done is not tracked here. Read the backlog for the current status.

## GDPR

| Article | Short name | Backlog tasks | Note |
|---|---|---|---|
| Art. 5 | Principles relating to processing of personal data | SEC-001 (data classification), SEC-006 (retention policies), SEC-004 (field encryption), SEC-003 (audit log), SEC-021 (GDPR documentation) | Covers minimisation, storage limitation, integrity and accountability. |
| Art. 6 | Lawfulness of processing | SEC-021 (GDPR documentation) | The tenant chooses and records the legal basis. The DPA template states it. |
| Art. 7 | Conditions for consent | EXP-007 (analytics consent and opt-out), SEC-021 (consent banner) | Applies to analytics and cookies. Care of patients does not rely on consent. |
| Art. 9 | Processing of special categories of personal data | SEC-001 (data classification), SEC-004 (field encryption), SEC-008 (pseudonymised research), SEC-021 (DPIA) | Health data is special category data. |
| Art. 12 | Transparent information and modalities for data subjects | SEC-007 (access and erasure workflows), SEC-021 (GDPR documentation) | Response deadlines are a tenant process that the export workflow supports. |
| Art. 13 | Information to be provided where data are collected from the data subject | Gap | Privacy notice for platform users. See the gap list. |
| Art. 14 | Information to be provided where data have not been obtained from the data subject | Policy | Patient notices are the tenant's duty. A template can go in the DPA pack from SEC-021. |
| Art. 15 | Right of access by the data subject | SEC-007 (access export) | |
| Art. 16 | Right to rectification | REPORT-010 (amendments and addenda), INGEST-019 (slide metadata editing) | Signed reports are amended, never overwritten. |
| Art. 17 | Right to erasure | SEC-007 (erasure workflow), SEC-006 (retention policies), SEC-004 (key destruction) | Reports kept under legal duty are exempt. |
| Art. 18 | Right to restriction of processing | Gap | A restriction flag on a patient or case. See the gap list. |
| Art. 19 | Notification obligation regarding rectification, erasure or restriction | Gap | Needs a recipient record for shared cases. See the gap list. |
| Art. 20 | Right to data portability | SEC-007 (access export) | The export format must be structured and machine readable. |
| Art. 21 | Right to object | Gap | Mostly a tenant decision. The analytics opt-out exists in EXP-007 (analytics consent and opt-out). |
| Art. 22 | Automated individual decision-making, including profiling | REPORT-008 (sign-out), REPORT-007 (AI disclosure), REPORT-006 (before-signing checklist), SEC-021 (DPIA) | A pathologist signs every report, so AI output is advice only. |
| Art. 24 | Responsibility of the controller | SEC-021 (GDPR documentation), SEC-019 (ISO policies) | |
| Art. 25 | Data protection by design and by default | SEC-001 (data classification), SEC-004 (field encryption), SEC-009 (label and macro handling), SEC-010 (PHI-safe telemetry), IAM-004 (row-level security) | |
| Art. 28 | Processor | SEC-021 (DPA template, subprocessor list), SEC-020 (subprocessor BAAs) | |
| Art. 30 | Records of processing activities | SEC-021 (records of processing), SEC-001 (data map) | |
| Art. 32 | Security of processing | SEC-002 (encryption), SEC-004 (field encryption), SEC-003 (audit log), IAM-004 (row-level security), SEC-014 (backups), SEC-015 (vulnerability management), SEC-022 (penetration test) | See the ISO tables for the full technical list. |
| Art. 33 | Notification of a personal data breach to the supervisory authority | SEC-018 (incident response runbook) | |
| Art. 34 | Communication of a personal data breach to the data subject | SEC-018 (incident response runbook) | |
| Art. 35 | Data protection impact assessment | SEC-021 (DPIA for AI-assisted diagnosis) | |
| Art. 36 | Prior consultation | SEC-021 (DPIA) | Needed only if the DPIA shows high residual risk. |
| Art. 37 | Designation of the data protection officer | Policy | Decision for the company. Record it in SEC-021. |
| Art. 44 | General principle for transfers | SEC-005 (data residency), SEC-021 (subprocessor list) | |
| Art. 45 | Transfers on the basis of an adequacy decision | SEC-005 (data residency), SEC-021 (subprocessor list) | |
| Art. 46 | Transfers subject to appropriate safeguards | SEC-021 (DPA template, subprocessor list), SEC-005 (data residency) | Standard contractual clauses go in the subprocessor contracts. |
| Art. 47 | Binding corporate rules | Policy | Not expected to apply. |
| Art. 48 | Transfers or disclosures not authorised by Union law | Policy | Procedure for foreign access requests. Add it to the contacts in SEC-018 (incident response runbook). |
| Art. 49 | Derogations for specific situations | Policy | Not relied on. Record that in SEC-021. |

## HIPAA Security Rule

Section 164.306 sets the general rules and has no row. Each row is a standard or an implementation specification.

| Section | Short name | Backlog tasks | Note |
|---|---|---|---|
| 164.308(a)(1)(i) | Security management process | SEC-016 (threat model), SEC-020 (HIPAA readiness pack) | Standard. |
| 164.308(a)(1)(ii)(A) | Risk analysis (R) | SEC-020 (risk analysis), SEC-016 (threat model) | |
| 164.308(a)(1)(ii)(B) | Risk management (R) | SEC-016 (threat model), SEC-015 (vulnerability management) | |
| 164.308(a)(1)(ii)(C) | Sanction policy (R) | Policy | Part of the staff policies in SEC-019 (ISO policies). |
| 164.308(a)(1)(ii)(D) | Information system activity review (R) | SEC-024 (audit log queries), SEC-017 (access reviews), OPS-006 (observability stack) | |
| 164.308(a)(2) | Assigned security responsibility (R) | Policy | Named in the information security policy from SEC-019. |
| 164.308(a)(3)(i) | Workforce security | IAM-006 (roles and permissions), IAM-014 (admin console) | Standard. |
| 164.308(a)(3)(ii)(A) | Authorization and/or supervision (A) | IAM-006 (roles and permissions), IAM-018 (supervision and signing rights) | |
| 164.308(a)(3)(ii)(B) | Workforce clearance procedure (A) | Policy | Staff screening. |
| 164.308(a)(3)(ii)(C) | Termination procedures (A) | IAM-020 (deactivation with hand-over), IAM-014 (admin console) | |
| 164.308(a)(4)(i) | Information access management | IAM-004 (row-level security), IAM-016 (roles narrowed by folders) | Standard. |
| 164.308(a)(4)(ii)(A) | Isolating health care clearinghouse functions (R) | Policy | Parfocal is not a clearinghouse. Record that in SEC-020. |
| 164.308(a)(4)(ii)(B) | Access authorization (A) | IAM-007 (invitations), IAM-006 (roles and permissions) | |
| 164.308(a)(4)(ii)(C) | Access establishment and modification (A) | IAM-014 (admin console), SEC-017 (access reviews) | |
| 164.308(a)(5)(i) | Security awareness and training | SEC-020 (workforce training record) | Standard. |
| 164.308(a)(5)(ii)(A) | Security reminders (A) | Policy | Part of the training programme. |
| 164.308(a)(5)(ii)(B) | Protection from malicious software (A) | INGEST-005 (malware and integrity scan), SEC-015 (vulnerability management) | |
| 164.308(a)(5)(ii)(C) | Log-in monitoring (A) | Gap | Alerts on repeated failed sign-ins. SEC-012 (rate limiting) is partial. |
| 164.308(a)(5)(ii)(D) | Password management (A) | IAM-001 (IdP and MFA policy) | Passwords and MFA are handled by the identity provider. |
| 164.308(a)(6)(i) | Security incident procedures | SEC-018 (incident response runbook) | Standard. |
| 164.308(a)(6)(ii) | Response and reporting (R) | SEC-018 (incident response runbook), OPS-007 (alerting and on-call) | |
| 164.308(a)(7)(i) | Contingency plan | OPS-008 (disaster recovery), SEC-014 (backups) | Standard. |
| 164.308(a)(7)(ii)(A) | Data backup plan (R) | SEC-014 (backups and restore testing), OPS-008 (disaster recovery) | |
| 164.308(a)(7)(ii)(B) | Disaster recovery plan (R) | OPS-008 (disaster recovery) | |
| 164.308(a)(7)(ii)(C) | Emergency mode operation plan (R) | OPS-008 (disaster recovery), OPS-011 (maintenance mode, partial) | The plan document is in SEC-019 (ISO policies). |
| 164.308(a)(7)(ii)(D) | Testing and revision procedures (A) | OPS-008 (DR drill), SEC-014 (restore testing) | |
| 164.308(a)(7)(ii)(E) | Applications and data criticality analysis (A) | SEC-019 (asset inventory), OPS-008 (disaster recovery objectives) | |
| 164.308(a)(8) | Evaluation (R) | SEC-022 (penetration test), SEC-017 (access reviews) | Periodic review of the safeguards. |
| 164.308(b)(1) | Business associate contracts and other arrangements | SEC-020 (BAA template, subprocessor BAAs) | Standard. |
| 164.308(b)(3) | Written contract or other arrangement (R) | SEC-020 (BAA template, subprocessor BAAs) | |
| 164.310(a)(1) | Facility access controls | Policy | Inherited from cloud providers. SEC-020 (subprocessor list) records the evidence. |
| 164.310(a)(2)(i) | Contingency operations (A) | Policy | Provider data centre arrangements. |
| 164.310(a)(2)(ii) | Facility security plan (A) | Policy | Provider data centre arrangements. |
| 164.310(a)(2)(iii) | Access control and validation procedures (A) | Policy | Provider data centre arrangements. |
| 164.310(a)(2)(iv) | Maintenance records (A) | Policy | Provider data centre arrangements. |
| 164.310(b) | Workstation use (R) | Policy | Staff device rules in SEC-019 (ISO policies). |
| 164.310(c) | Workstation security (R) | Policy, IAM-009 (session policies) | IAM-009 locks idle sessions. |
| 164.310(d)(1) | Device and media controls | Policy | Standard. |
| 164.310(d)(2)(i) | Disposal (R) | Policy, SEC-006 (retention policies) | Hardware disposal is policy. Data deletion is SEC-006. |
| 164.310(d)(2)(ii) | Media re-use (R) | Policy | |
| 164.310(d)(2)(iii) | Accountability (A) | SEC-019 (asset inventory) | |
| 164.310(d)(2)(iv) | Data backup and storage (A) | SEC-014 (backups and restore testing) | |
| 164.312(a)(1) | Access control | IAM-004 (row-level security), IAM-006 (roles and permissions) | Standard. |
| 164.312(a)(2)(i) | Unique user identification (R) | IAM-005 (users and memberships), IAM-011 (service accounts) | |
| 164.312(a)(2)(ii) | Emergency access procedure (R) | IAM-017 (emergency access with a reason), SEC-017 (break-glass for staff) | |
| 164.312(a)(2)(iii) | Automatic logoff (A) | IAM-009 (session policies), IAM-021 (lock screen) | |
| 164.312(a)(2)(iv) | Encryption and decryption (A) | SEC-002 (encryption in transit and at rest), SEC-004 (field encryption) | |
| 164.312(b) | Audit controls (R) | SEC-003 (audit log), SEC-024 (audit log queries and export) | |
| 164.312(c)(1) | Integrity | SEC-003 (hash-chained audit log), SEC-023 (signature record) | Standard. |
| 164.312(c)(2) | Mechanism to authenticate electronic protected health information (A) | SEC-023 (signature record with content hash), INGEST-005 (integrity scan) | |
| 164.312(d) | Person or entity authentication (R) | IAM-001 (IdP and MFA), IAM-002 (login through the BFF), IAM-019 (emailed code) | |
| 164.312(e)(1) | Transmission security | SEC-002 (encryption in transit), SEC-011 (security headers) | Standard. |
| 164.312(e)(2)(i) | Integrity controls (A) | SEC-002 (encryption in transit), INGEST-005 (integrity scan) | |
| 164.312(e)(2)(ii) | Encryption (A) | SEC-002 (encryption in transit) | |
| 164.314(a) | Business associate contracts or other arrangements | SEC-020 (BAA template, subprocessor BAAs) | Standard. |
| 164.314(b) | Requirements for group health plans | Policy | Not applicable to Parfocal. Record that in SEC-020. |
| 164.316(a) | Policies and procedures | SEC-019 (ISO policies), SEC-020 (HIPAA readiness pack) | Standard. |
| 164.316(b)(1) | Documentation | Policy | Standard. Docs live in `docs/compliance/`. |
| 164.316(b)(2)(i) | Time limit (R) | Policy | TODO: confirm the retention period for documentation with counsel. |
| 164.316(b)(2)(ii) | Availability (R) | Policy | Documents are available to the staff who apply them. |
| 164.316(b)(2)(iii) | Updates (R) | Policy | Review on a schedule set in SEC-019. |

## ISO/IEC 27001:2022 Annex A

### Organisational controls

| Control | Short name | Backlog tasks | Note |
|---|---|---|---|
| 5.1 | Policies for information security | SEC-019 (ISO policies) | |
| 5.2 | Information security roles and responsibilities | Policy | Named in SEC-019 (ISO policies). |
| 5.3 | Segregation of duties | IAM-006 (roles and permissions), OPS-005 (deploy approval), SEC-017 (staff access) | |
| 5.4 | Management responsibilities | Policy | |
| 5.5 | Contact with authorities | SEC-018 (incident response contacts) | |
| 5.6 | Contact with special interest groups | Policy | |
| 5.7 | Threat intelligence | Gap | SEC-015 (vulnerability management) is partial. See the gap list. |
| 5.8 | Information security in project management | SEC-016 (threat model) | The Definition of Done in the backlog also applies. |
| 5.9 | Inventory of information and other associated assets | SEC-001 (data map), SEC-019 (asset inventory) | |
| 5.10 | Acceptable use of information and other associated assets | Policy | |
| 5.11 | Return of assets | Policy | |
| 5.12 | Classification of information | SEC-001 (data classification) | |
| 5.13 | Labelling of information | SEC-001 (classes declared on columns) | |
| 5.14 | Information transfer | SEC-002 (encryption in transit), NOTIF-004 (emails without PHI), REPORT-013 (report delivery hook) | |
| 5.15 | Access control | IAM-006 (roles and permissions), IAM-004 (row-level security), IAM-016 (roles narrowed by folders) | |
| 5.16 | Identity management | IAM-005 (users and memberships), IAM-013 (SCIM), IAM-020 (deactivation) | |
| 5.17 | Authentication information | IAM-001 (IdP and MFA), SEC-013 (secrets management), IAM-011 (API tokens) | |
| 5.18 | Access rights | IAM-014 (admin console), IAM-007 (invitations), SEC-017 (access reviews) | |
| 5.19 | Information security in supplier relationships | SEC-019 (supplier management policy), SEC-020 (subprocessor list) | |
| 5.20 | Addressing information security within supplier agreements | SEC-020 (BAAs), SEC-021 (DPA template) | |
| 5.21 | Managing information security in the ICT supply chain | FOUND-014 (dependency scanning), SEC-015 (vulnerability management) | |
| 5.22 | Monitoring, review and change management of supplier services | Policy | Part of the supplier policy in SEC-019. |
| 5.23 | Information security for use of cloud services | SEC-019 (supplier management policy), SEC-020 (subprocessor list), SEC-005 (data residency) | |
| 5.24 | Information security incident management planning and preparation | SEC-018 (incident response runbook) | |
| 5.25 | Assessment and decision on information security events | SEC-018 (incident response runbook) | |
| 5.26 | Response to information security incidents | SEC-018 (incident response runbook) | |
| 5.27 | Learning from information security incidents | SEC-018 (tabletop exercise) | |
| 5.28 | Collection of evidence | SEC-003 (audit log), SEC-024 (signed audit export) | |
| 5.29 | Information security during disruption | OPS-008 (disaster recovery), SEC-019 (continuity policy) | |
| 5.30 | ICT readiness for business continuity | OPS-008 (disaster recovery), SEC-014 (backups), OPS-007 (alerting) | |
| 5.31 | Legal, statutory, regulatory and contractual requirements | SEC-021 (GDPR documentation), SEC-020 (HIPAA readiness pack) | This matrix is part of the register. |
| 5.32 | Intellectual property rights | FOUND-014 (licence scanning) | |
| 5.33 | Protection of records | SEC-003 (audit log), SEC-006 (retention policies), SEC-023 (signature record) | |
| 5.34 | Privacy and protection of PII | SEC-004 (field encryption), SEC-007 (access and erasure), SEC-008 (pseudonymised research), SEC-010 (PHI-safe telemetry) | |
| 5.35 | Independent review of information security | SEC-022 (external penetration test) | |
| 5.36 | Compliance with policies, rules and standards for information security | Policy | Internal audit. SEC-017 (access reviews) gives evidence. |
| 5.37 | Documented operating procedures | PILOT-003 (operations runbooks), PILOT-002 (admin documentation) | |

### People controls

| Control | Short name | Backlog tasks | Note |
|---|---|---|---|
| 6.1 | Screening | Policy | |
| 6.2 | Terms and conditions of employment | Policy | |
| 6.3 | Information security awareness, education and training | SEC-020 (workforce training record) | |
| 6.4 | Disciplinary process | Policy | |
| 6.5 | Responsibilities after termination or change of employment | IAM-020 (deactivation with hand-over) | Contract terms are policy. |
| 6.6 | Confidentiality or non-disclosure agreements | Policy | |
| 6.7 | Remote working | Policy | |
| 6.8 | Information security event reporting | SEC-018 (incident response runbook) | |

### Physical controls

All physical controls are inherited from the cloud providers or apply to staff offices and devices. Evidence for the provider part comes from attestations tracked in SEC-020 (subprocessor list).

| Control | Short name | Backlog tasks | Note |
|---|---|---|---|
| 7.1 | Physical security perimeters | Policy | Provider data centres. |
| 7.2 | Physical entry | Policy | Provider data centres. |
| 7.3 | Securing offices, rooms and facilities | Policy | |
| 7.4 | Physical security monitoring | Policy | Provider data centres. |
| 7.5 | Protecting against physical and environmental threats | Policy | Provider data centres. |
| 7.6 | Working in secure areas | Policy | |
| 7.7 | Clear desk and clear screen | Policy, IAM-009 (idle lock) | |
| 7.8 | Equipment siting and protection | Policy | |
| 7.9 | Security of assets off-premises | Policy | |
| 7.10 | Storage media | Policy | |
| 7.11 | Supporting utilities | Policy | Provider data centres. |
| 7.12 | Cabling security | Policy | Provider data centres. |
| 7.13 | Equipment maintenance | Policy | |
| 7.14 | Secure disposal or re-use of equipment | Policy | |

### Technological controls

| Control | Short name | Backlog tasks | Note |
|---|---|---|---|
| 8.1 | User endpoint devices | Policy, IAM-009 (session policies) | |
| 8.2 | Privileged access rights | SEC-017 (break-glass and staff access), IAM-017 (emergency access) | |
| 8.3 | Information access restriction | IAM-004 (row-level security), IAM-016 (roles narrowed by folders), IAM-010 (guest links) | |
| 8.4 | Access to source code | Policy | Repository permissions. |
| 8.5 | Secure authentication | IAM-001 (IdP and MFA), IAM-002 (login through the BFF), IAM-019 (emailed code) | |
| 8.6 | Capacity management | OPS-012 (load and soak testing), OPS-009 (cost controls) | |
| 8.7 | Protection against malware | INGEST-005 (malware and integrity scan) | |
| 8.8 | Management of technical vulnerabilities | SEC-015 (vulnerability management), FOUND-014 (dependency scanning) | |
| 8.9 | Configuration management | OPS-001 (infrastructure as code), IAM-001 (IdP config as code) | |
| 8.10 | Information deletion | SEC-006 (retention policies), SEC-007 (erasure workflow) | |
| 8.11 | Data masking | SEC-008 (pseudonymised research), SEC-009 (label and macro handling) | |
| 8.12 | Data leakage prevention | Gap | SEC-009 and SEC-010 are partial. Export and download controls are a gap. |
| 8.13 | Information backup | SEC-014 (backups and restore testing), OPS-008 (disaster recovery) | |
| 8.14 | Redundancy of information processing facilities | OPS-008 (disaster recovery) | |
| 8.15 | Logging | SEC-003 (audit log), FOUND-011 (structured logging), OPS-006 (observability stack) | |
| 8.16 | Monitoring activities | OPS-006 (observability stack), OPS-007 (alerting and on-call) | |
| 8.17 | Clock synchronization | Gap | Confirm what the platform providers guarantee. See the gap list. |
| 8.18 | Use of privileged utility programs | Policy | |
| 8.19 | Installation of software on operational systems | OPS-005 (continuous deployment), FOUND-015 (container images) | |
| 8.20 | Networks security | SEC-002 (encryption in transit), SEC-011 (security headers), SEC-012 (rate limiting) | |
| 8.21 | Security of network services | OPS-001 (infrastructure as code), SEC-019 (supplier management policy) | |
| 8.22 | Segregation of networks | Gap | See the gap list. |
| 8.23 | Web filtering | Policy | Staff endpoints only. |
| 8.24 | Use of cryptography | SEC-002 (encryption), SEC-004 (field encryption), SEC-013 (secrets management), STACK-037 (key management) | |
| 8.25 | Secure development life cycle | FOUND-007 (CI pipeline), TEST-014 (security tests in CI) | |
| 8.26 | Application security requirements | SEC-016 (threat model), SEC-011 (security headers) | |
| 8.27 | Secure system architecture and engineering principles | SEC-016 (threat model), IAM-004 (row-level security) | |
| 8.28 | Secure coding | FOUND-006 (lint and hooks), TEST-014 (security tests in CI) | |
| 8.29 | Security testing in development and acceptance | TEST-014 (security tests in CI), SEC-022 (penetration test) | |
| 8.30 | Outsourced development | Policy | Part of the supplier policy in SEC-019. |
| 8.31 | Separation of development, test and production environments | OPS-003 (environments) | |
| 8.32 | Change management | OPS-005 (continuous deployment), FOUND-017 (release versioning) | |
| 8.33 | Test information | TEST-016 (test data hygiene), FOUND-016 (shared test fixtures) | No PHI in fixtures. |
| 8.34 | Protection of information systems during audit testing | SEC-022 (penetration test scope) | Rules of engagement for testers. |

## Counts

| Framework | Rows | With a task | Policy only | Gap |
|---|---|---|---|---|
| GDPR | 31 | 22 | 5 | 4 |
| HIPAA Security Rule | 61 | 42 | 18 | 1 |
| ISO/IEC 27001:2022 Annex A | 93 | 60 | 29 | 4 |

Rows that name both a task and Policy count as "With a task".

## Gaps and candidate tasks

Each gap below is a candidate new task. SEC-000 does not add any of them to the backlog.

- Privacy notice text for platform users (GDPR Art. 13). Add it to SEC-021 or create a task for the notice and its page.
- Restriction of processing (GDPR Art. 18). A flag that freezes a patient or case for everything except storage and legal claims, with audit entries. Fits next to SEC-007.
- Notification of recipients after rectification, erasure or restriction (GDPR Art. 19). Needs a record of who received a shared case or an export.
- Right to object (GDPR Art. 21). Decide with the tenant what applies. Only the analytics part exists, in EXP-007.
- Log-in monitoring (HIPAA 164.308(a)(5)(ii)(C)). Alert on repeated failed sign-ins and unusual locations, using IdP events and SEC-012.
- Threat intelligence (ISO 5.7). Subscribe to advisories for the stack and record how they are triaged. Extends SEC-015.
- Data leakage prevention (ISO 8.12). Controls on export, download, print and share of slides and reports, with audit entries. Related to REPORT-015 and SEC-009.
- Clock synchronization (ISO 8.17). Confirm the time source of every platform component and record it. Matters for audit log timestamps and signatures.
- Network segregation (ISO 8.22). Document how the edge, API, workers and data stores are separated on the chosen platform, and test it. Extends OPS-001.
