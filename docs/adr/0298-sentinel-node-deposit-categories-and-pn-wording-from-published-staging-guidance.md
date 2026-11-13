# 0298. Sentinel node deposit categories and pN wording follow AJCC 8th edition breast and ICCR, checked from published texts

- Date: 2026-11-13
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: MEAS-000 (research check for the measurement categories and pN wording)

## Context

[ADR 0012](0012-ux-round-2-prototype-revisions.md) (UX round 2 prototype revisions) put sentinel node staging on the findings panel. A node is sorted by its largest deposit into macrometastasis over 2 mm, micrometastasis over 0.2 mm or more than 200 cells, and isolated tumor cells (ITC) up to 0.2 mm and up to 200 cells, with a suggested pN stage. It said the wording had to be checked with a pathologist before a doctor sees it. The project has no pathologist, so this check uses published staging texts instead.

## Sources read

| Source | What it confirms |
| --- | --- |
| [AJCC current staging system table, 2026](https://www.facs.org/media/c5ik5tkr/ajcc-current-staging-system-2026.pdf) | Breast (chapter 48) is still on the 8th edition in 2026. No Version 9 breast chapter exists |
| [ACS slide deck "Breast, AJCC 8th Edition Staging"](https://www.facs.org/media/5hydy4eh/breast-ajcc-8th-edition-staging.pdf) | Three size categories: ITC is pN0(i+) at 0.2 mm or less, micrometastasis is pN1mi over 0.2 mm and up to 2.0 mm, metastasis over 2.0 mm applies to all pN+ subcategories except pN1mi. pN needs at least one node examined under the microscope, sentinel procedure included |
| [ICCR lymph node general information, breast dataset](https://www.iccr-cancer.org/datasets/docs/iccr-ln-generalinfo) | Nodes are classed by the largest deposit. The 200 cell limit separates ITC from micrometastasis, and its flow chart (after Cserni et al., Eur J Cancer 2011) puts up to 200 cells in pN0(i+) and more than 200 in pN1mi. Above 200 cells, measure the largest span. If in doubt, choose the lower category. Sentinel biopsy without later axillary dissection is marked (sn), as in pN0(sn). pN is used only with a pT, otherwise a sentinel biopsy is cN, as in cN1(sn) |
| [NCI PDQ Breast Cancer Treatment, health professional version, Table 4](https://www.cancer.gov/types/breast/hp/breast-treatment-pdq) | Reproduces the AJCC 8th edition pN table: pN0(i+) is ITC only with clusters of 0.2 mm or less, pN1mi is micrometastases of about 200 cells, over 0.2 mm and up to 2.0 mm. The (sn) and (f) suffixes mark metastasis confirmed by sentinel node biopsy or by fine needle aspiration or core biopsy with no further node resection |
| [Koh and Kim, Korean J Radiol 2019;20(1):69-82, Table 5](https://pmc.ncbi.nlm.nih.gov/articles/PMC6315072/) | Same AJCC 8th edition pN0(i+) and pN1mi rows, and cN(sn) for nodes confirmed by sentinel biopsy |

## Options considered

1. Keep the ADR 0012 wording unchanged and wait for a pathologist, which the project will never have.
2. Confirm the wording from the published texts above, scope it to breast carcinoma, and show a per node deposit category with a pN suggestion that carries its limits.

## Decision

Option 2.

- The per node categories in ADR 0012 match the published breast texts: macrometastasis over 2.0 mm, micrometastasis over 0.2 mm up to 2.0 mm or more than 200 cells, ITC 0.2 mm or less and 200 cells or fewer. Exactly 200 cells stays ITC, as in the ICCR flow chart. The deposit is the largest one in the node, measured as its largest span, and a borderline case takes the lower category.
- A single node gives a deposit category, never a pN stage on its own. pN1mi, pN0(i+) and pN0 follow from the worst node, but any node over 2.0 mm makes the stage depend on how many nodes are positive (pN1a for one to three axillary nodes), so the suggestion counts positive nodes across the case.
- The suggestion carries the (sn) suffix when only sentinel nodes were examined, as in pN1mi(sn) or pN0(i+)(sn).
- The wording says "suggested" and names the AJCC 8th edition. When the case has no pT, the screen shows the deposit categories and no pN suggestion, because pN needs a pT.
- This applies to breast carcinoma sentinel nodes only. Other specimens get no category until their own rules are checked.
- This published text check replaces the pathologist check that ADR 0012 asked for. Doctors in the pilot still decide the stage.

## Consequences

- The findings panel and exports name the edition, so a future AJCC Version 9 breast chapter means a reviewed update, not a silent change.
- Counting positive nodes needs a node count per case, which the staging work must store.
- TODO: the current CAP breast resection protocol (Breast.Invasive.Res 4.11.0.0, at `documents.cap.org`) could not be opened from this machine because the host did not resolve. Its wording is not confirmed.
- TODO: the AJCC rule that drops (sn) when six or more sentinel and non-sentinel nodes are removed was seen only in a study guide summary, never in a primary text. Until confirmed, the suggestion always adds (sn) when only sentinel nodes were examined.
- TODO: the AJCC qualifier that the 200 cells are counted in a single histologic cross section was not seen in the texts read.
- TODO: rules for other sentinel node sites, such as melanoma, vulva or other carcinomas, were not checked.
