# 0052. A task board read from the backlog, with one claim file per task

- Date: 2026-10-15
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: FOUND-020

## Context

The backlog holds 606 tasks in 40 epics. Ticks in `docs/BACKLOG.md` say what is done, but nothing says what is being worked on right now, who has it, what waits on the owner, or which tasks are free to start because their dependencies are done. Several agents now work in parallel, and two of them must never pick the same task. The owner wants a kanban view that updates as work happens, a dependency tree per task, and links from every task to the ADRs, results, knowledge files and log entries about it.

Constraints: `docs/` is the project memory ([ADR 0001](0001-docs-as-project-memory.md)), so the board must not become a second source of truth. Parallel agents work on separate branches, so a shared status file would conflict on every merge. External sends happen only from production ([ADR 0005](0005-external-sends-only-in-production.md)).

## Options considered

1. GitHub Projects or issues, one per task. A good board out of the box, but the task text would live in two places, agents in cloud sessions have no `gh` CLI, and the issues would drift from the backlog.
2. One status file such as `docs/board.json` that every agent edits. Simple, but parallel branches would conflict on it constantly, and it duplicates the ticks.
3. A status column inside `docs/BACKLOG.md`. Keeps one file, but every claim rewrites the 3,000-line backlog, which conflicts with ticks and task edits on other branches.
4. The board is computed from the backlog, with one small claim file per active task in `docs/board/active/`, a Python script with no dependencies and one HTML page. Two agents only touch the same file if they claim the same task, which is the conflict we want git to report.

## Decision

Option 4. `scripts/board.py` parses `docs/BACKLOG.md` on every request, so ticks, new tasks and dependency edits show at once. A task's column comes from, in order, its tick (done), its claim file (in progress, review, blocked or on hold), "(on hold)" in its title, and its "Depends on" line (waiting until every named task is ticked, ready otherwise). Dependencies that are not task IDs, such as "the final UI shell", are shown as a note and do not move the task.

`python3 scripts/board.py serve` serves the page on `127.0.0.1` only, refreshes it every 4 seconds and reads docs only from `docs/`, `README.md` and `AGENTS.md`. `build` writes the same page as one self-contained file. The page links a task to every doc that names its ID and to every log line that does. The CLI gives agents `ready`, `show`, `tree`, `claim`, `move`, `release` and `check`, and the docs workflow runs `check`.

## Consequences

- An agent claims a task when it starts and deletes the claim when the task is ticked. `check` fails CI if a ticked task still has a claim file, if a claim names an unknown task or status, or if the dependencies name an unknown task or form a cycle.
- The "ready" column is only as good as the "Depends on" lines. On 2026-10-15 only 122 of 606 tasks declare dependencies, so many tasks show as ready that really wait on an earlier task in their epic. Adding missing "Depends on" lines improves the board and needs no code change.
- Claims made on a branch show on `main` only after a merge. A session sees its own claims and those already merged.
- The blocked tasks listed in "Next up" of [docs/README.md](../README.md) were seeded as claim files with the owner as the holder.
