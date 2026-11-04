# 0186. Incident response follows GDPR with Parfocal as processor first, a 24 hour notice to workspaces and a register kept in the repository without PHI

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner (accepted 2026-11-04 with industry standard defaults)
- Backlog: SEC-018 (incident response and breach notification runbook). Touches SEC-021 (GDPR documentation, DPA clause 4.6), SEC-020 (HIPAA readiness pack) and OPS-007 (alerting and on-call)

## Context

SEC-018 asks for a runbook, a recorded tabletop exercise and alert contacts. Parfocal is processor for everything a workspace stores and controller for its own processing ([records-of-processing.md](../compliance/records-of-processing.md)). GDPR Art. 33 gives a controller 72 hours to tell the supervisory authority and Art. 33(2) asks a processor to tell the controller without undue delay. The [DPA template](../compliance/dpa-template.md) draft says 24 hours and waits on this task. HIPAA does not apply yet. One person runs the project, agents may not delete, rotate or reset in production without the owner's yes ([ADR 0151](0151-standing-approval-for-production-within-30-dollars.md)), and the repository is public.

## Options considered

| Option | For | Against |
|---|---|---|
| 1. Processor notice in 24 hours, register in the repository holding no PHI and pointing to a private record | Gives each workspace two thirds of its 72 hours. The register is versioned and found by every session | Real breach details need a second, private place |
| 2. Processor notice "without undue delay" with no number | Matches the article's words | Workspaces cannot plan, and many DPAs ask for a number |
| 3. Register in a private store only | Nothing leaks through the public repository | Agents and later sessions cannot see that it exists or how it is shaped |
| 4. Write for GDPR and HIPAA at once | One runbook for both | HIPAA's rules do not apply yet and would add duties nobody can check |

## Decision

Option 1, GDPR only. The runbook [incident-response.md](../compliance/incident-response.md) sets three severity levels, splits duties by Parfocal's role, keeps the 72 hour clock from awareness, tells workspaces within 24 hours as the DPA draft says, and lists containment steps that respect ADR 0151's ask rules. The [register](../compliance/incident-register.md) keeps only IDs, dates and severities for real breaches. The [tabletop exercise](../compliance/tabletop-exercise.md) is ready to run, and its record stays empty until people run it. HIPAA's Breach Notification Rule waits for SEC-020.

## Consequences

- The owner accepted 24 hours for telling workspaces and 72 hours for the supervisory authority (Art. 33) on 2026-11-04. If counsel changes the 24 hours in SEC-030 (legal review before the first real tenant), the runbook's clock table changes with it.
- Alert contacts cannot be set from the repository. The runbook lists the channels that exist, all of them about cost, and an owner checklist for security contacts.
- The owner is incident lead and privacy contact until staff exist, and `security@parfocal.eu` is the security contact once OPS-013 (email routing for support and security) routes it. The private place for full breach records stays a TODO for the owner, and the supervisory authority, national CSIRT and counsel wait for the legal entity in SEC-030.
- Workspaces have no security contact field. SEC-029 (security contact for each workspace) adds it, and until then a notice goes to the workspace owners.
- The first tabletop exercise was run on paper by an agent on 2026-11-04 and is recorded in [tabletop-exercise.md](../compliance/tabletop-exercise.md). With the contacts set above, SEC-018 is done.
