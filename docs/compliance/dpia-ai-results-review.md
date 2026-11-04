# DPIA for AI-assisted review of whole slides

This is the data protection impact assessment that GDPR Article 35 asks for, written for SEC-021 (GDPR documentation). It covers Parfocal as the product is described in [ADR 0053](../adr/0053-ai-results-review-direction.md) (the AI results review direction) on 2026-11-03. Each workspace is the controller of its own processing and should adopt or extend this assessment for its own use, as the [DPA template](dpa-template.md) says.

Status: draft by Parfocal agents with the generic defaults the owner accepted on 2026-11-04. Parfocal claims no clinical use, so the product is research software and no medical device assessment under the EU MDR is made. TODO: counsel, and the DPO if one is named, sign it before the first tenant with real patient data (SEC-030), and a medical device assessment comes first if any clinical use is ever claimed.

## Why a DPIA is needed

The processing combines health data (Article 9), new technology (AI models on whole slide images) and, in clinical use, possible influence on decisions about patients. Any one of these points to a DPIA under Article 35(1) and the supervisory authorities' lists.

## The processing

| Point | Description |
|---|---|
| What | Researchers upload whole slides, import AI results or run built-in and lab models on demand. Reviewers answer agree, disagree or unsure for each object the model marked, fix outlines, comment and fill opinion forms. A researcher signs off and exports the evaluation |
| Whose data | Patients whose tissue is on the slides, and the researchers and reviewers who use the workspace |
| Which data | Slide pixels, slide labels, barcodes and file names, specimen details, and in clinical projects sealed patient identifiers (name, MRN, birth date) with sex and age. For users: identity, role and every review action tied to a user id. The full list is the [data map](../reference/data-map.md) |
| Two privacy modes | A de-identified project (the research default) has no patient fields and strips names on upload. A clinical project allows optional patient fields, hides names and logs access |
| Where | Cloudflare, Modal, Neon and Zitadel Cloud, listed in [subprocessors.md](subprocessors.md) |
| How long | Per workspace retention with legal hold ([ADR 0089](../adr/0089-retention-purge-and-audit-re-anchor.md)), erasure of patients and members ([ADR 0090](../adr/0090-access-export-and-erasure.md)) |
| Pilot scope | Only public slide datasets and seeded fake patients ([ADR 0003](../adr/0003-pilot-platform-architecture.md)). No real patient data is processed until the PHI trigger of ADR 0003 fires |

## Necessity and proportionality

- Purpose. Evaluating AI results against expert review, in research and in quality work. The workspace records its legal basis under Articles 6 and 9, for example scientific research under 9(2)(j) or health care under 9(2)(h). Parfocal does not choose it.
- Minimisation. De-identified projects are the default. Patient fields are optional even in clinical projects. Slide labels and macro images are shown only to readers of the whole project in clinical projects ([ADR 0124](../adr/0124-labels-and-macros-only-for-whole-project-readers-in-clinical-projects.md)). Logs, traces and analytics carry only allow-listed fields and pseudonymous ids ([ADR 0040](../adr/0040-observability-and-phi-scrubbing.md), [ADR 0171](../adr/0171-analytics-without-device-storage.md)).
- Accuracy. Reviewer edits go into a separate reviewed layer, so the model's output and the human correction are both kept. Sign-off is a soft lock with a change log, so later edits stay visible.
- Data subject rights. Access export and erasure exist for members and patients (SEC-007). Restriction under Article 18 is a known gap in [controls.md](controls.md).

## Article 22: no automated decision

The model only proposes. Every object it marks is shown to a person who agrees, disagrees or answers unsure, and a person signs off the evaluation. Parfocal makes no decision about a patient. The tenant must keep a person in that loop in its own workflow, which the DPA template states.

## Risks and measures

Likelihood and severity are the agents' assessment for a tenant with real patient data, before the measures.

| Risk | Likelihood | Severity | Measures | Residual |
|---|---|---|---|---|
| Automation bias: a reviewer accepts a wrong AI outline and a wrong result reaches a patient's care | Possible | High | Unsure is always an answer. Blinding options in review tasks. Disagreement queue before sign-off. Results show model, version, date and source. Evaluation metrics per [ADR 0093](../adr/0093-evaluation-metrics-and-datasets.md). Parfocal is not a medical device and the tenant decides clinical use | Medium. TODO: the owner decides whether any clinical use needs a regulatory assessment |
| Model bias: a model works worse on some tissue, stain or population | Possible | Medium | Held-out evaluation per organ and tissue (ADR 0093). Results are evaluated, not trusted | Medium |
| Another tenant sees a workspace's data | Unlikely | High | Row level security on every tenant table, tested through the pooler (IAM-004), tenant keys for patient identifiers (SEC-004) | Low |
| Re-identification of a de-identified slide through its label, barcode, macro image or file name | Possible | High | Names stripped on upload in de-identified projects, label and macro rules (SEC-009, ADR 0124), file names classed as phi in the data map | Medium. TODO: SEC-008 (pseudonymised research) and label redaction on the image itself |
| Patient data reaches logs, error reports or analytics | Possible | Medium | One scrubbing rule set with an allow-list (ADR 0040), only production exports (ADR 0005), SEC-010 scans an E2E run for seeded names | Low |
| Unfinished upload names stay in the browser | Possible | Low | Resume hints hold project, case, file name and size in `sessionStorage` only, which the browser clears when the tab closes ([cookies-and-storage.md](cookies-and-storage.md)) | Low |
| Transfer outside the EEA: Neon is in US East and Modal has no region pin | Certain today | Medium | No real patient data in the pilot. ADR 0003 requires EU regions or SCCs before real patient data | High until the PHI trigger work is done, then to be reassessed |
| Misuse by an insider of the workspace | Possible | High | Roles per workspace and project, emergency access with a reason (IAM-017), hash chained audit log of every access (SEC-003), access reviews (SEC-017) | Medium |
| Loss of data or service | Unlikely | Medium | Backups and restore testing (SEC-014), disaster recovery (OPS-008) | Medium until those tasks are done |
| Erased data lingers in backups | Certain | Low | Backups expire. TODO: SEC-014 states the period | Low |

## Outcome

- With the pilot's fake patients, the residual risk is low and no prior consultation under Article 36 is needed.
- For real patient data, the transfer risk stays high until the regions are pinned or SCCs are in place. Real patient data must not be accepted before that. If any risk stays high after the PHI trigger work, the controller consults the supervisory authority under Article 36 before processing.
- Review this DPIA when the PHI trigger fires, when a new model type or a new subprocessor is added, and at least once a year.
