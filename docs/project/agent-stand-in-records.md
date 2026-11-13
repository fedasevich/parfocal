# Records where an agent stood in for a person

No pathologist, counsel or outside reviewer works on Parfocal, and the owner cannot read every record. So in the places below an agent did what a person would normally do. That is fine for building the product. It is not evidence that a person checked anything, and the thesis must not cite it as such. The owner chose decision 82a (what the thesis claims about people) on 2026-11-13: the thesis claims only measured technical results and public dataset ground truth, and labels every check listed here as simulated. Risk R20 in [risks.md](risks.md) tracks this page.

Each file listed here says so itself, in a line that starts with "Simulated check" or in the words quoted below. Result files are the exception, because results are not edited after the fact. For them the row on this page is the mark. Add a row and a mark in the same change whenever an agent stands in for a person again.

## A pathologist

| Record | What the agent did | What a real check needs |
|---|---|---|
| [ADR 0194](../adr/0194-confidence-display-rules-and-evidence.md) (confidence display rules), "Wording review of zone names and type hints" | Reviewed the confidence zone names and the cell type hints as the reviewing pathologist, at the owner's request in decision 44c (pathologist check) | One practising pathologist reads the names and hints over real slides and says which ones mislead. PILOT-005 (moderated usability study, second round) can carry it |

The same record says its numbers come from a replay "with a reviewer who is always right, and no doctor has used any of it". That replay is listed under measurements below.

## The people in an exercise

| Record | What the agent did | What a real check needs |
|---|---|---|
| [tabletop-exercise.md](../compliance/tabletop-exercise.md), the record of 2026-11-04, and the line about it in [ADR 0186](../adr/0186-incident-response-and-breach-notification.md) (incident response and breach notification) | One agent session played the facilitator, the incident lead, the technical responder and the privacy contact on paper, at the owner's request in decision 42 (incident response) | The owner, who holds those roles, runs the scenario live against a clock with one more person reading the injects |

## Counsel, a privacy professional or an auditor

Agents wrote every page below from the code and the decision records. None was read by a lawyer, a data protection officer or an auditor. SEC-030 (legal review of the GDPR documents before the first real tenant) is the real check for all of them, and it is on hold.

| Record | What it is |
|---|---|
| [dpia-ai-results-review.md](../compliance/dpia-ai-results-review.md) | Data protection impact assessment, a draft until counsel signs it |
| [dpa-template.md](../compliance/dpa-template.md) | Article 28 data processing agreement template, not legal advice |
| [records-of-processing.md](../compliance/records-of-processing.md) | GDPR Article 30 records of processing |
| [subprocessors.md](../compliance/subprocessors.md) | Subprocessor list with transfer notes |
| [cookies-and-storage.md](../compliance/cookies-and-storage.md) | Cookie and consent policy, with the reading that no consent banner is needed |
| [incident-response.md](../compliance/incident-response.md) | Incident response and breach notification runbook |
| [controls.md](../compliance/controls.md) | Control matrix for GDPR, the HIPAA Security Rule and ISO 27001:2022 |

## An outside security reviewer

| Record | What the agent did | What a real check needs |
|---|---|---|
| [threat-model.md](../security/threat-model.md) | Wrote the STRIDE threat model | SEC-022 (external penetration test), which is on hold |
| [Tenant isolation review](../results/2026-11-09-tenant-isolation-review.md), [edge token review](../results/2026-11-09-edge-token-review.md) and [viewer engine review](../results/2026-11-09-viewer-engine-review.md) | Read the code and reported findings. Each result says "A read-only review by an agent" | The same external test, and a second reader for the confirmed findings |
| [Project review](../results/2026-11-09-project-review.md) | Reviewed how the project is built. The result does not say who did it, and results are not edited after the fact, so this row is its mark | The owner's and the supervisor's reading of it |

## A user in a measurement

These results are real measurements on public data. What stands in for a person is the input: clicks placed by a rule and a reviewer who never errs. Each result describes its rule in its method section.

| Record | What stands in for the person | What a real check needs |
|---|---|---|
| [Interactive protocol on TNBC](../results/2026-11-06-interactive-protocol-on-tnbc.md) and [smart select accuracy smoke](../results/2026-11-06-smart-select-accuracy-smoke.md) | An "ideal click" at the deepest interior point and a "realistic click" at the centroid with a Gaussian miss | Clicks recorded from annotators, through PILOT-005 (moderated usability study, second round) |
| The evidence table in [ADR 0194](../adr/0194-confidence-display-rules-and-evidence.md) (confidence display rules) | A reviewer who is always right | Decisions recorded from reviewers in the pilot |
| [ADR 0067](../adr/0067-class-taxonomy-and-colour-check.md) (class taxonomy and colour check) with the [class colour separation result](../results/2026-10-17-class-colour-separation.md) | Computed colour differences under simulated protanopia, deuteranopia and tritanopia | A reader with a colour vision deficiency telling the classes apart on a slide |

## The owner

Agents accept decision records under the owner's standing approval, and the owner reads them later or not at all (risk R12 in [risks.md](risks.md)). The `Deciders` line of each record is its mark. It names the owner alone only when the owner decided. Otherwise it says "standing approval", "to confirm", "owner to review" or names the agent. This command lists them:

```sh
git grep -n -E "^- Deciders:.*(standing approval|to confirm|to review|agent|Claude)" -- docs/adr
```

[standing-approval-records.md](standing-approval-records.md) sums up ADR 0054 (hospital code inventory and revert order) through ADR 0091 (notification catalogue and targets) on one page. TODO: no such page exists for the later records. A real check is the owner reading a summary page and writing in [decisions.md](../decisions.md) to reopen a record.
