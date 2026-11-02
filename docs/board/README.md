# Task board

A kanban view of [BACKLOG.md](../BACKLOG.md) that follows the work as it happens ([ADR 0052](../adr/0052-task-board-from-backlog-and-claim-files.md)). The backlog stays the only source of tasks and ticks. This folder only holds what the backlog cannot say: who is working on what and what is stuck.

## Open the board

```
pnpm board
```

This runs `python3 scripts/board.py serve --open` and opens http://127.0.0.1:4310/. The page re-reads the backlog, the claim files, the log and every doc every 4 seconds, so a tick, a claim or a new ADR shows without a reload. `pnpm board:build` writes the same page as one file to `tmp/board.html` for sharing or reading offline.

The page has four views. Board shows the columns, filtered by milestone, epic or search. Epics shows progress per epic. Status shows the counts, the claim files, milestones, "Where we are now", "Next up" and the latest log entries. Docs lists every ADR, result and knowledge file with the tasks it names. Opening a task shows its text, what it needs and what it unblocks, a tree of both all the way through, and every ADR, result, doc and log line that names it. Links between tasks and docs open in the same panel, and the URL keeps the place so it can be shared.

## Columns

| Column | When a task is in it |
|---|---|
| Waiting on deps | A task named in its "Depends on" line is not ticked |
| Ready | Every task it depends on is ticked and nobody has claimed it |
| In progress | Its claim file says `in-progress` |
| Review | Its claim file says `review`, for example built and waiting for CI on `main` |
| Blocked or on hold | Its claim file says `blocked` or `on-hold`, or its title ends with "(on hold)" |
| Done | Its box is ticked in the backlog |

A dependency that is not a task ID, such as "the final UI shell", is shown on the task but does not move it. Use a `blocked` claim file for that.

## Sizes and quick wins

A task body may hold a line `Size: S.`, `Size: M.` or `Size: L.` S is one kind of check in one area and under an hour, M touches API and UI or needs two kinds of check, and L is a new system or needs an ADR first. Where the line is missing, `board.py` guesses the size from the "Done when" sentence and the body length, and the card shows the guess with a question mark. Write the line only where the guess is wrong.

`Needs: owner.` marks a task that cannot finish without the owner's yes for a production write or for new spend ([ADR 0115](../adr/0115-production-access-and-spend-caps.md), production access and spend caps). Nothing else counts. Questions go into `docs/decisions.md` with a recommended option and the work carries on, agents use the owner's Mac for every browser and device check, and no task may wait on a pathologist.

Each card shows how many open tasks wait on it all the way down. Status lists quick wins, which are ready S tasks with no `Needs` line, no `Idea:` title and no "(moved)" or "(dropped)" at the end of the title, sorted by that count, next to the tasks that unblock the most and a table of epics that depend on each other. `python3 scripts/board.py ready --size S --agent-only` prints the same quick wins.

## Claim files

One file per active task, `active/<ID>.md`, so parallel agents never edit the same file unless they take the same task.

```
status: in-progress
by: claude (session or branch name)
branch: claude/some-branch
since: 2026-10-15
note: One line on where it stands.

Optional longer notes in Markdown.
```

`status` is one of `in-progress`, `review`, `blocked` or `on-hold`. The other fields are optional.

## Commands for agents

| Command | What it does |
|---|---|
| `python3 scripts/board.py ready [--epic IAM] [--milestone M1] [--size S] [--agent-only]` | Tasks whose dependencies are done and that nobody holds, with size and unblock count. `--agent-only` skips `Needs`, `Idea:`, moved and dropped tasks |
| `python3 scripts/board.py show IAM-009` | The task, both dependency trees, its docs and its log lines |
| `python3 scripts/board.py tree IAM-009 [--down]` | Only the tree of what it needs, or with `--down` what it unblocks |
| `python3 scripts/board.py claim IAM-009 --by NAME [--branch B] [--note N]` | Take a task. Refuses a done or taken task, and one whose dependencies are open unless `--force` |
| `python3 scripts/board.py move IAM-009 review --note "..."` | Change the column of a claimed task |
| `python3 scripts/board.py release IAM-009` | Delete the claim file, when the task is ticked or given up |
| `python3 scripts/board.py brief` | The "In progress" note from `docs/README.md`, every claimed task and how many are ready |
| `python3 scripts/board.py find viewer tools` | Tasks whose ID or title holds every word |
| `python3 scripts/board.py recent [N]` | The newest log entries, cut to 200 characters |
| `python3 scripts/board.py note "PROTO-019 (viewer tools) ..."` | Adds a log entry on top under today's date. Name the task ID when there is one |
| `python3 scripts/board.py tick IAM-009` | Ticks the task in the backlog and deletes its claim file |
| `python3 scripts/board.py check` | Fails on claims for ticked or unknown tasks, unknown statuses, unknown dependencies, unknown `Size` or `Needs` values and cycles. The docs workflow runs it |

Commit the claim file with the first change of the task, and delete it in the change that ticks the box.
