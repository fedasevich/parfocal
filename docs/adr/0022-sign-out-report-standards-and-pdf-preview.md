# 0022. Sign-out report built to CAP synoptic rules with ICCR datasets and TNM 8, with a PDF preview, print and share

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: edits REPORT-000, REPORT-003, REPORT-005, REPORT-006, REPORT-007, REPORT-008, REPORT-009 and REPORT-010. Adds REPORT-014, REPORT-015, REPORT-016 and REPORT-017.

## Context

The owner asked for the sign-out to produce the documents pathologists are used to, following an industry standard, with a PDF they can look at, print and share. The mock (step 15, Report and PDF) and the kit's Sign-out report page now show it. These are the sources checked on 2026-10-08.

| Source | What it fixes | Version |
| --- | --- | --- |
| [CAP Cancer Protocols](https://documents.cap.org/protocols/Breast.Invasive.Res_4.11.0.0.REL_CAPCP.pdf) | Synoptic format: each core and conditional element as "element: response" on its own line, all together in one place. Core, conditional and optional (+) elements. Core elements appear even as "Not applicable" or "Cannot be determined". Lymph node element names, answers and pN categories | Breast Invasive Resection 4.11.0.0, posted June 2026, required from March 2027. CAP's host did not resolve from the review machine, so the element text was read from 4.9.0.0 (June 2023) through the Internet Archive |
| [ICCR, surgically removed lymph nodes for breast tumours](https://www.iccr-cancer.org/datasets/published-datasets/breast/surgically-removed-lymph-nodes-for-breast-tumours/) | The dataset for a node specimen on its own: 10 core and 2 non-core elements, from operative procedure and nodes examined to size of largest metastasis, extranodal extension and pN | 1st edition, v1.2, May 2021 |
| UICC and AJCC TNM 8 | pN with (sn) when fewer than six nodes are removed, (i+) for isolated tumour cells only, mi for micrometastases. "p" needs the primary tumour removed | As quoted in the CAP and ICCR forms |
| [42 CFR 493.1291](https://www.law.cornell.edu/cfr/text/42/493.1291) | What every report shows (patient identification, laboratory name and address, report date, test, specimen source, result) and that a corrected report keeps the original | Paragraphs (c) and (k) |
| [IHE APSR](https://wiki.ihe.net/index.php/Anatomic_Pathology_Structured_Report) | Structured report on HL7 CDA R2, where the diagnostic conclusion is the one required section. CAP electronic checklists travel today as HL7 v2.5 with NAACCR Volume V | APSR 2.x, PaLM technical framework |
| [CAP Molecular Oncology Committee](https://www.captodayonline.com/a-start-at-standardizing-neoplastic-cellularity-assessment/) | Tumour cell content for molecular testing (13 recommendations on defining, estimating and checking neoplastic cellularity) | Devereaux et al., Arch Pathol Lab Med 2022;146:1062-1071 |
| [CAP AI hub](https://www.cap.org/education/practice-hubs/artificial-intelligence-ai-in-pathology/) | No CAP or ICCR wording exists yet for AI use in a report. Reporting recommendations are planned | Checked 2026-10-08 |

## Options considered

1. Free-text report with our own layout. Quick, but unfamiliar to clinicians and not what accreditation checks.
2. CAP synoptic rules with the ICCR dataset for the specimen and TNM 8 staging, in the usual report sections. This is what pathologists and clinicians read today, and the ICCR dataset is international, which suits a Czech pilot.
3. A national template only. TODO: no published Czech national template was found, and the supervisor question in the kit asks which one a Czech laboratory uses.

## Decision

Option 2. The standards and rules below are the decision. Screen layout, controls and wording follow the prototype at the time a task is built.

- The report runs in the usual order: laboratory and report status, patient and dates, an amendment box when amended, specimen, clinical history, final diagnosis in the diagnostic-line style, the synoptic block with the standards it follows, comment, gross, microscopic, slides and stains, AI assistance and the electronic signature with the attestation. Pages are A4 with a running header from page 2 and "Page n of N".
- For a sentinel node the synoptic block uses ICCR's elements with CAP's names and TNM 8 pN. The AI line is a local element and is labelled as such.
- Values come only from what the doctor confirmed or from the LIS. An empty core element reads "Waiting" with what it needs, and Sign out stays disabled until it is filled or answered "Cannot be determined".
- One data model fills the screen, the PDF and the outgoing messages. Where each value came from shows on screen in the draft only and never prints. A draft carries a DRAFT watermark.
- The doctor can see the PDF exactly as it will be stored, print it, download it and share it. Share follows the state. A draft only goes to a colleague for a read. A signed report goes to the requesting clinician automatically. It can also join a tumor board pack, go out as a secure expiring link or to another laboratory, and reach the patient portal after the hospital's release delay.
- An amendment keeps the signed original and says what changed, why, when and by whom.
- The cell case reports tumour cell content for molecular testing. It gives the block, the outlined field, the share of nucleated cells that are tumour cells with its range, whether it clears the assay minimum, and a macrodissection note.
- The AI statement names the model and version, says what it did and what the pathologist reviewed, and says no value was set without review. It is a proposal until guidance appears.

## Consequences

- REPORT-000 must re-read CAP 4.11.0.0 itself before REPORT-003 is built, because the element text here came from 4.9.0.0.
- STACK-035 must produce a PDF whose pages match the on-screen preview, which favours an HTML and CSS route (WeasyPrint or Chromium print) over Typst unless both can share one layout.
- REPORT-017 adds HL7 v2 and IHE APSR output next to the FHIR DiagnosticReport in REPORT-013.
- The share menu needs secure expiring links (IAM-010) and tumor board packs (HOME-009).
- TODO: confirm the Czech template, language and registry coding (ICD-O-3, SNOMED) with the supervisor before the pilot.
