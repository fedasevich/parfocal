# Thesis structure

Parfocal is the practical part of the owner's master's thesis. This page holds the chapter structure agreed after the supervisor meeting on 2026-10-20 and says where in this repository and in the POC the material for each section already lives. Write the text so that a section can be filled from the sources named next to it.

## What the supervisor asked for

- The introduction needs a motivation.
- The analysis has to include the state of the art.
- The proposed solution, everything that is built, is described in one big chapter.
- The thesis has a technical part that describes the source code and the implementation.

## Assignment

The assignment, "Web application for expert review and evaluation of AI results on whole-slide pathology images", was drafted on 2026-10-20 and is not in KOS yet. Its text and a table of which step feeds which section below are in the POC thesis research under [Draft assignment for the WSI thesis](https://github.com/fedasevich/pathlogy-poc/blob/master/thesis-research/analysis/report.md#draft-assignment-for-the-wsi-thesis). When either changes, update the other.

## Chapters

The target is 20,000 to 28,000 words, about 85 to 115 pages, which is the middle half of A-level application theses at FIT ([POC thesis research](https://github.com/fedasevich/pathlogy-poc/blob/master/thesis-research/analysis/report.md)). Shares are of the main body.

| Chapter | Sections | Share | Sources |
|---|---|---|---|
| 1 Introduction | 1.1 Motivation: AI models for whole slides score well on public benchmarks, but a lab has to check them on its own slides, and doctors' time is the scarce part. 1.2 The problem and the goals. 1.3 The scope boundary, a review tool and not a hospital system. 1.4 How the text is organised | 5% | [overview.md](overview.md), [ADR 0053](../adr/0053-ai-results-review-direction.md), POC doc 37 |
| 2 Analysis | 2.1 The domain: whole slides, pyramids and formats, kinds of AI result. 2.2 State of the art: slide viewers (OpenSeadragon, Viv, deck.gl, QuPath, ASAP), research and clinical platforms (Cytomine, EXACT, Concentriq and others), interactive AI and review tools (MONAI Label, HoVer-Net, PathoSAM), and the gap between them. 2.3 Users, personas and roles. 2.4 Functional and non-functional requirements. 2.5 Summary | 20% | POC `docs/presentation1`, `docs/presentation2`, docs 08, 20 and 35, the kit's Personas page, [ADR 0096](../adr/0096-researcher-and-reviewer-with-admin-rights.md), [BACKLOG.md](../BACKLOG.md) "Decisions already made" |
| 3 Proposed solution | 3.1 Overview of the review loop, from upload to the signed report. 3.2 Rendering: the custom WebGPU engine, Viv and deck.gl compared by measurement, and the choice. 3.3 Architecture. 3.4 Data model: projects, cases, slides, result sets, object IDs and the reviewed layer. 3.5 Review workflow: tasks, verdicts, opinion forms, disagreements, sign-off, roles and permissions. 3.6 The evaluation report and study templates. 3.7 User interface design and its feedback rounds. 3.8 Technical part: the source code. 3.9 Testing. 3.10 Evaluation: rendering and review performance, and the models on held-out sets. 3.11 Deployment | 67% | See the next table |
| 4 Conclusion | Goals against what was achieved, limits, future work | 8% | [roadmap.md](roadmap.md), [risks.md](risks.md) |

Appendices: a user guide, the source code layout with how to build and run it, the Parfocal results schema ([reference/parfocal-results-v1.md](../reference/parfocal-results-v1.md)), the test scenarios, the use of AI tools, and the contents of the attached media.

## Sources for chapter 3

| Section | Share | In this repository | In the POC |
|---|---|---|---|
| 3.1 Overview | 3% | [overview.md](overview.md), [ADR 0053](../adr/0053-ai-results-review-direction.md) | doc 37, the hi-fi mock |
| 3.2 Rendering | 8% | [ADR 0043](../adr/0043-server-slide-reading.md), [knowledge/viewer-build.md](../knowledge/viewer-build.md) | docs 04, 05, 07, 09, 23, 24, 27, 31 and 32 |
| 3.3 Architecture | 5% | ADRs [0003](../adr/0003-pilot-platform-architecture.md), [0018](../adr/0018-postgres-sqlalchemy-rls.md), [0024](../adr/0024-workspaces-are-tenants.md), [0025](../adr/0025-zitadel-bff-login.md), [0044](../adr/0044-background-jobs-and-workflows.md), [knowledge/platform.md](../knowledge/platform.md) | |
| 3.4 Data model | 4% | ADRs [0062](../adr/0062-project-model.md), [0063](../adr/0063-cases-and-slides-in-projects.md), [0071](../adr/0071-object-id-grammar.md), [0076](../adr/0076-annotation-and-ai-result-storage.md), [0077](../adr/0077-result-sets.md), [0079](../adr/0079-reviewed-layer.md), [knowledge/database.md](../knowledge/database.md) | doc 37 "Data model" |
| 3.5 Review workflow | 4% | ADRs [0069](../adr/0069-slide-pipeline.md), [0072](../adr/0072-verdicts-reasons-and-opinion-forms.md), [0078](../adr/0078-review-task-model.md), [0080](../adr/0080-disagreement-rule-and-sign-off.md), [0096](../adr/0096-researcher-and-reviewer-with-admin-rights.md), [reference/permissions.md](../reference/permissions.md) | docs 37 and 43 |
| 3.6 Report and templates | 2% | ADRs [0083](../adr/0083-typst-for-report-pdfs.md), [0084](../adr/0084-evaluation-metrics.md), [0097](../adr/0097-report-templates-built-from-blocks.md), [knowledge/evaluation.md](../knowledge/evaluation.md) | doc 43 |
| 3.7 Interface design | 6% | ADRs [0012](../adr/0012-ux-round-2-prototype-revisions.md), [0013](../adr/0013-cell-findings-shortcuts-and-ai-on-upload.md), [0095](../adr/0095-ux-round-5-upload-by-slide-and-verdict-notes.md) | docs 25, 33, 35 and 37 to 43, the UX kit, the usability study |
| 3.8 Technical part | 20% | The root [README](../../README.md), [knowledge/](../knowledge/README.md) (api, jobs, results, slide formats, tooling), [ADR 0006](../adr/0006-monorepo-tooling.md), [ADR 0007](../adr/0007-python-tooling.md) | doc 06, doc 30 |
| 3.9 Testing | 6% | ADRs [0009](../adr/0009-quality-gates.md), [0011](../adr/0011-hosted-ci-only.md), the Definition of Done in [BACKLOG.md](../BACKLOG.md), [knowledge/test-fixtures.md](../knowledge/test-fixtures.md) | |
| 3.10 Evaluation | 6% | [ADR 0093](../adr/0093-evaluation-metrics-and-datasets.md), [results/](../results/README.md) | docs 13, 21, 26 and 29 |
| 3.11 Deployment | 3% | ADRs [0003](../adr/0003-pilot-platform-architecture.md), [0050](../adr/0050-deploy-pipeline-and-previews.md), [0051](../adr/0051-availability-status-and-back-up.md), [knowledge/infra.md](../knowledge/infra.md) | |

## How the data backs this structure

The POC's thesis research checked the one big chapter against 799 application theses from DSpace with readable tables of contents (`thesis-research/analysis/solution_chapter.py` in the POC).

| Share of application theses with | Under 80 | 80 to 90 | 90 and more |
|---|---:|---:|---:|
| One chapter holding design and implementation | 25% | 25% | 29% |
| One chapter that also holds testing | 5% | 7% | 7% |
| Motivation as its own heading in or after the introduction | 15% | 14% | 10% |
| State of the art or a survey as a heading | 39% | 39% | 44% |

- A combined chapter is common, usually titled "Realizace", "Implementace", "Praktická část" or "Návrh", and the mean score is the same with and without one (88.4 against 88.1). Among SI theses scoring 90 or more, 35% use one.
- Putting testing into the same chapter is rare, at 5 to 7%. It is not punished in the data, but the reviewers' most common complaint about weak texts is unclear structure (37% of reports on theses under 80 against 13% for A theses). The big chapter therefore keeps numbered sections that each answer one question, and testing, evaluation and deployment stay sections of their own so a reader finds them in the contents.
- A-level texts explain implementation decisions rather than walking through code, so the technical part describes the layout, the contracts and the hard parts, and leaves listings to the attached media.

TODO: confirm with the supervisor whether testing, evaluation and deployment may stay inside chapter 3 or should follow it as chapters 4 to 6.
