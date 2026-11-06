# 0252. A clinical report is stored per case in columns, with deposits in rows, signed versions as snapshots and the node taken from the slide's block

- Date: 2026-11-06
- Status: Accepted
- Deciders: Claude, for the owner
- Backlog: REPORT-024 (clinical report model and API). Builds on [ADR 0134](0134-clinical-report-per-case-with-sign-out-and-co-sign.md) (clinical report per case with sign-out and co-sign) and [ADR 0086](0086-node-staging-rules.md) (node staging rules)

## Context

[ADR 0134](0134-clinical-report-per-case-with-sign-out-and-co-sign.md) gives a project in Clinical privacy mode one clinical report per case. The report must keep earlier signed versions readable, class its text as `phi`, count positive nodes and pin a template version. The draft client from the mock keys the report by slide, and the database has no node number.

## Options considered

1. One JSON document per report. Few columns, but no data class per field and no database checks on sizes, states or categories.
2. Columns on `clinical_reports` for the values, a `clinical_deposits` row per deposit and a `clinical_report_versions` row per signature holding a JSON snapshot of the values and staging.
3. A full history table of every field change. Complete, but the audit log already records which fields changed.

## Decision

Option 2.

- The report lives at `/api/projects/{project_id}/cases/{case_id}/clinical-report`, one per case, so the flow page reaches it from the slide's case. The draft client's slide-keyed paths are replaced when REPORT-025 (clinical report flow page) wires the page.
- The project holds `clinical_template`, the sentinel node report by default, and a report copies the key and version when it is created.
- A deposit's size is above 0 or empty. A deposit from a measurement takes its length, a deposit from another object may have no size, which is a blocker, and a hand deposit needs its size.
- A node is the slide's block when it has one, otherwise the slide. Nodes positive counts the distinct nodes with a deposit.
- A confirmation of a contradicting category stores the suggested category it was given against, so a new largest deposit asks again.
- Signing writes version 1 and amending writes the next version with its reason. Every version keeps its values and staging as a snapshot.
- Text columns and version snapshots are classed `phi`. Audit entries name fields and states, never values.

## Consequences

- REPORT-008 (sign-out of a clinical report) adds the single sign-on or password confirmation to the sign endpoint, and REPORT-019 (co-sign of a clinical report) adds the side-by-side view on top of the send, return and sign transitions.
- PROJ-008 (project settings) sets `clinical_template`.
- TODO: the owner confirms that a node is the slide's block, or else the case gains a node number per slide.
