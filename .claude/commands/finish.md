---
description: Finish a backlog task, log it, tick or move it, commit and push
argument-hint: TASK-ID
---
Finish backlog task $ARGUMENTS.

1. Run `bash scripts/verify-changed.sh 2>&1 | tail -40`, plus the browser specs the task touched. If it fails, fix it or stop and report. Never push red. CI runs the full `pnpm -s verify`.
2. Run `python3 scripts/board.py note "$ARGUMENTS (plain name) ..."` with one to three sentences: what was done, where, anything surprising.
3. If the "Done when" line is fully true, run `python3 scripts/board.py tick $ARGUMENTS`. If it waits on the owner, run `python3 scripts/board.py move $ARGUMENTS review --note "one sentence"`.
4. Add an ADR, result file or knowledge entry only if one is due (docs/knowledge/agent-workflow.md). Put any owner question in `docs/decisions.md`.
5. Stage files by name, commit as `type($ARGUMENTS): Subject` with the header at most 100 characters, push.
6. Report in at most five lines: commit, state, open questions.
