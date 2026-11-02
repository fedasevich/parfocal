# 0136. A lean agent workflow

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-021, changes the ritual from FOUND-002 and ADR 0001

## Context

An audit of 27 session transcripts on 2026-11-02 found the cost in how agents reach the docs, not in the docs. These counts come from the transcript files and were not re-measured after the change.

| Measure | Value |
|---|---|
| Whole or wide reads of `docs/BACKLOG.md` (430 KB) and `docs/log.md` (321 KB) | 409 and 284 |
| Subagents, total context tokens | 74, about 3.7 billion |
| Turns per subagent, median and largest | 208 and 530 |
| Context per subagent turn, typical and peak | 230k to 390k, about 1.2M |
| Screenshots read by the guided review screen agent | about 89 |
| Longest main session | 3295 turns, 4 compactions |
| `AGENTS.md`, loaded by every session and subagent | 16.5 KB |

Fable gave a second opinion and agreed on the causes.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep the ritual, ask agents to be careful | No work | Rules already existed and were not followed |
| Split `BACKLOG.md` and `log.md` into many files | Small reads | Breaks the board, links and history |
| Make `board.py` the entry point, guard the big files, trim the guide, budget subagents | Small change, enforced by a hook | Agents need new habits, savings are estimates |

## Decision

The third option. `board.py` gains `brief`, `find`, `recent`, `note` and `tick`. A PreToolUse hook blocks whole reads of the two big files. `AGENTS.md` drops to about 6.5 KB and the rarely used procedures move to [knowledge/agent-workflow.md](../knowledge/agent-workflow.md), which also sets an output budget, model choice per kind of work and a turn budget per subagent. `/start`, `/finish` and `/consolidate` commands and the `task-runner` and `ui-porter` agents carry the ritual. `pnpm verify` runs every check quietly, and `pnpm --filter @parfocal/web shot` takes small screenshots and compares them by number.

## Consequences

Agents read a 2.5 KB task brief instead of the backlog, write shorter docs and hand back sooner. Log entries get shorter, so `board.py show` shows more of them. The README "Where we are now" section is still long until the next consolidation. TODO: measure tokens per finished task over the next few sessions and compare against the table above.
