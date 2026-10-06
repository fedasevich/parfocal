# 0001. Keep project memory in docs and share one agent guide

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-002, FOUND-003

## Context

The build will run over many agent sessions, often with context compacted or lost between them. More than one coding agent may work on the repository. Decisions, measurements and lessons from the POC were spread across 35 research docs and chat history, which made them hard to find again.

## Options considered

1. Rely on chat history and agent memory tools. Nothing to maintain, but the knowledge is invisible to other agents and people, and it cannot be reviewed in a pull request.
2. Keep everything in `docs/` with fixed places for status, decisions, measurements and lessons, and one agent guide that every agent reads. It costs a few minutes per task but survives any session and is versioned with the code.

## Decision

Option 2. `docs/` is the project memory. `AGENTS.md` is the single agent guide and `CLAUDE.md` imports it. The log is append-only raw memory. The docs index, the project files and the knowledge folder are consolidated memory that is rewritten on a fixed trigger. ADRs hold decisions and result files hold every number.

## Consequences

Every task updates `docs/` in the same change as the code. Consolidation runs at each milestone or about every 15 log entries. External memory tools may keep recall and session history but never hold the only copy of anything durable.
