# 0002. Adopt the planning-session decisions as the baseline

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: all epics

## Context

Before writing the backlog, a planning session settled scope questions that every later task depends on. They cover release bar, deployment, compliance, renderer, formats, AI runtime and scope, UX variants, devices, collaboration, reporting, language, offline support, UX research, sequencing and testing.

## Options considered

1. Leave the choices implicit in the task texts. Easy now, but later sessions could not tell a deliberate choice from an accident.
2. Record them once as a baseline that every task inherits, and change them only through a new ADR.

## Decision

Option 2. The table "Decisions already made" in [BACKLOG.md](../BACKLOG.md) is the accepted baseline. The tech stack itself is not part of it. Each stack slot is decided by its STACK task and ADR.

## Consequences

Changing a row of that table needs a new ADR that supersedes the row, and the backlog table and the affected tasks are edited in the same change. Model licensing (STACK-031) is explicitly still open.
