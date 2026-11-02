---
description: Start a backlog task with the lean ritual
argument-hint: TASK-ID
---
Start backlog task $ARGUMENTS.

1. Run `python3 scripts/board.py show $ARGUMENTS`. If a dependency is open or the task is claimed, stop and say so in one line.
2. Read only the ADRs, knowledge files and POC refs it lists, and only the parts you need. Do not open `docs/BACKLOG.md`, `docs/log.md` or `docs/README.md` whole.
3. Run `python3 scripts/board.py claim $ARGUMENTS --by "$(git config user.name)-agent"`.
4. Say in at most three lines what you will build and which tests prove it, then build it.
