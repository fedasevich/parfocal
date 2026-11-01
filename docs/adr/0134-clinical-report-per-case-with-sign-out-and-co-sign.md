# 0134. A clinical project has a clinical report per case, laid out by a clinical report template with every deposit in its staging, and signed out under the Can sign out right or co-signed

- Date: 2026-11-01
- Status: Proposed
- Deciders: Yurii Fedas, in round 6 of the POC mock (POC doc 44, the round 6 working mock), written up by Claude
- Backlog: REPORT-024 (clinical report model and API), REPORT-025 (clinical report flow page), PROJ-009 (Can sign out, a project right in clinical projects), brings back REPORT-008 (sign-out of a clinical report) and REPORT-019 (co-sign of a clinical report) from the ideas, changes PROJ-008 (project settings), REPORT-010 (amendments and addenda, an idea), SEC-023 (electronic signature record, an idea) and ADAPT-003 (revert signing rights and supervision). Builds on [ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md) (researcher and reviewer with admin rights), which records the Can sign out right, and narrows [ADR 0053](0053-ai-results-review-direction.md) (AI results review direction), which kept every clinical report as an idea

## Context

[ADR 0053](0053-ai-results-review-direction.md) made the evaluation report the only output and kept the hospital's synoptic sign-out report as ideas, the REPORT epic. A project in Clinical privacy mode can still hold real cases, and round 6 of the POC mock (POC doc 44) showed that such a project needs a report per case that a pathologist signs. [ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md) already records who may sign: each member of a clinical project holds the project right Can sign out as Own cases, Any case or Never, and a member without it sends the report for co-sign. What is missing is the report itself, its staging and the backlog tasks for both.

## Options considered

1. Keep clinical reports as ideas. Nothing to build, but a clinical project ends at the evaluation report and the right ADR 0096 records has nothing to sign.
2. Bring back the whole REPORT epic: the ICCR and CAP template engine, prefill rules, the before-signing checklist, delivery through an outbox, HL7, FHIR and code mappings. Complete, but it is the hospital product that ADR 0053 left behind.
3. A narrow report per case in a clinical project only. Its steps come from a small clinical report template, the sentinel node template stages every deposit, and the report is signed out under the Can sign out right or co-signed. Delivery, HL7, FHIR, addenda and the rest of the epic stay ideas.

## Decision

Option 3, as the owner built it in round 6 of the mock.

- Only a project in Clinical privacy mode has clinical reports, one per case. A de-identified project has none, and the right does not exist there.
- The project picks a clinical report template in its settings. Two are built in: the sentinel node report, whose steps are Findings, Staging, Report text and Sign out, and the lymph node excision report, which has no Staging step. Another specimen needs a template with its own staging step or none. Editing templates stays with REPORT-002 (template engine, an idea).
- Findings lists read-only facts drawn from the reviewer's decisions and measurements, each with a link that opens it on the slide, and asks for the specimen.
- Staging lists every deposit as a row with its slide, the object ID it comes from or "measured by hand", its size in millimetres and an optional note. A deposit is added by picking an object from the case's slides with type-to-find or by a hand measurement above 0, and a row can be removed with an Undo. The largest deposit sets the suggested category through the staging rules of [ADR 0086](0086-node-staging-rules.md), macrometastasis over 2 mm, micrometastasis from 0.2 to 2 mm, and isolated tumour cells up to 0.2 mm and 200 cells, and is marked "Largest, sets the category". Nodes positive counts the nodes with at least one deposit. A category that contradicts the largest size can be kept only with an explicit confirmation. The suggested pN is read-only.
- Report text holds the final diagnosis, which is required, the microscopic description and a comment, with measurements inserted with their source, and a read-only line naming ICCR, CAP and TNM 8.
- Sign out lists every value with a way back to its step, then the blockers: a required field empty, a deposit without a size or the category not confirmed. A member whose right covers the case signs out, confirming with the institution's single sign-on and the password as a fallback. A member without it picks a co-signer from the members whose right covers the case. Own cases covers a case when the member holds an assignment on one of its slides.
- The co-signer reads the report with both values side by side, may change values, and either returns it with a note of 10 to 300 characters or co-signs and signs it out. The signed report then names both people.
- A signed report is a fixed version with its signer and time. Amending it needs a reason of 10 to 300 characters, signs again and keeps the earlier version readable.

## Consequences

- REPORT-024 (clinical report model and API), REPORT-025 (clinical report flow page) and PROJ-009 (Can sign out, a project right in clinical projects) are new. REPORT-008 and REPORT-019 lose their `Idea:` prefix and are rewritten to this shape, without the idea tasks they depended on. The REPORT epic and the ideas paragraph say which of its tasks are planned.
- PROJ-008 (project settings) gains the Can sign out column for members and the clinical report template.
- ADAPT-003 (revert signing rights and supervision) is ticked and stays so. It gains a line saying that sign-out came back in this narrower form.
- The research viewer no longer stages a node. Staging lives in the clinical report, and the research viewer's Objects tab lists the objects instead (POC doc 44). TODO: PROJ-005 (analysis templates), REVIEW-004 (staging hero and size scale) and MEAS-006 (measure as a step of the area) still put staging in the viewer and need a backlog pass of their own.
- The meaning of Own cases is the reading of this record. TODO: the owner confirms that an assignment on one of the case's slides is what makes a case one's own.
