# Agent workflow

The procedures [AGENTS.md](../../AGENTS.md) points to. Read a section only when you do that thing. The cost numbers behind these rules are in [ADR 0136](../adr/0136-lean-agent-workflow.md) (a lean agent workflow).

## Reading the big docs

`docs/BACKLOG.md` (about 430 KB) and `docs/log.md` (about 320 KB) are never read whole. A hook in `.claude/settings.json` blocks `cat`, `head`, `tail`, `less` and wide `sed` ranges on them.

| Need | Command |
|---|---|
| What is going on | `python3 scripts/board.py brief` |
| A task with its refs, trees, docs and log | `python3 scripts/board.py show ID` |
| Find a task | `python3 scripts/board.py find WORDS` or `grep -n` |
| Recent work | `python3 scripts/board.py recent 10` |
| Free tasks | `python3 scripts/board.py ready [--epic X]` |
| Log a finished task | `python3 scripts/board.py note "ID (name) ..."` |
| Tick a task | `python3 scripts/board.py tick ID` |

## Output budget

Every word written is paid for again by every later reader.

| What | Limit |
|---|---|
| Log entry | 1 to 3 sentences: what, where, anything surprising. Detail goes in the commit body or a knowledge file |
| Claim note | One sentence |
| Hand-back from a subagent | At most 10 lines: done or not, commit, what is left, questions |
| Chat report to the owner | At most 10 lines plus questions |
| ADR | About one page. Options as a short table |
| `docs/decisions.md` item | Two sentences of context, one line per option |
| README "Where we are now" | At most 15 lines. "Next up" at most 8 one-line items |
| Knowledge entry | A heading and 2 to 5 lines |

Name a group of tasks by its epic or purpose ("the PROTO screen tasks") instead of listing every ID.

## Subagents

- One task per fresh subagent. Use `.claude/agents/task-runner.md` or `.claude/agents/ui-porter.md`. Never fork the main session for task work, because a fork carries its whole context.
- At most two alive at once.
- Budget about 120 turns. When a run passes it, or the work is plainly bigger than one task, the agent commits what is green, leaves a claim `note:` with the next step and hands back.
- The main session only picks tasks, spawns, relays questions and merges. End it after one epic or about three tasks and start fresh.

| Work | Model |
|---|---|
| Porting mock screens, routine UI, tests for existing code | Sonnet, medium effort |
| ADRs, research checks, backend design, security, tricky bugs | Opus |
| Board moves, index rows, log lines, simple doc edits | Haiku |
| Second opinion | Fable, once before starting and once before hand-back, never per turn |

## Checks and output

- Run `pnpm -s verify 2>&1 | tail -40` two or three times per task, not after every edit. While working, run only the test file you touch.
- Pipe long output through `tail`, `head -50` or `grep`. Never print whole generated files, lockfiles or full diffs. Use `git diff --stat` first.

## Screenshots

An image costs a lot and stays in context for every later turn.

- Shoot small: `pnpm --filter @parfocal/web shot URL out.png` writes 720 by 450 by default.
- Compare by number first: add `--against MOCK_URL_OR_PNG` to get the share of pixels that differ and a diff image.
- Open an image only when the number says something is wrong, at most about 5 per task. The owner's review against the mock catches the rest.

## Starting and finishing a task

`/start ID` and `/finish ID` in `.claude/commands/` do these steps. By hand:

1. `board.py show ID`, check that "Depends on" is ticked, and read only the ADRs, knowledge files and POC refs it lists.
2. `board.py claim ID --by NAME` and commit the claim file with the first change.
3. Write the code and the tests the "Done when" line names, then run `pnpm -s verify`.
4. `board.py note`, then `board.py tick ID` if "Done when" is fully true, or `board.py move ID review --note "..."` if it waits on the owner.
5. An ADR if a real choice was made, a result file if something was measured, a knowledge entry if a later session would trip on it. Update README "In progress" only if it changed.
6. Stage files by name, commit, push.

When stopping mid-task, leave the claim with a `note:` naming the exact next step and any broken or uncommitted state.

## Decision records

Copy `docs/adr/0000-template.md` to the next free number. Status stays `Proposed` until the owner agrees. Never rewrite an accepted record. Write a new one and mark the old one `Superseded by NNNN`. If the ADR changes a backlog task, edit that task in the same change. Add a row to `docs/adr/README.md`.

## Results

Copy `docs/results/_template.md` to `docs/results/YYYY-MM-DD-topic.md`. Record the task, commit, environment and exact method, put raw numbers in tables, keep facts apart from interpretation and compare against the budget or the POC number. Add a row to `docs/results/README.md`. Never invent a number. Write `TODO` and say what would measure it.

## The owner's decisions file

`docs/decisions.md` holds every open question for the owner.

- It starts with a line where the owner can write "all recommended", then a short table of what landed.
- Each item has a heading like `1a` with a plain title, two sentences of context, options A, B, C and Other with the recommended one in bold and a few words why, then a blank `Your choice:` line.
- When the owner answers, apply each choice, log it and delete the answered item. Keep only open items.
- When two branches both add items, keep both and renumber.

## Consolidation

Do this when a milestone closes, when the owner asks, or about every 15 log entries since "Last consolidated" in `docs/README.md`.

1. Read the log since the last consolidation with `board.py recent`.
2. Rewrite "Where we are now" and "Next up" from scratch within the output budget.
3. Move repeated or costly lessons into `docs/knowledge/`, merging into an existing topic file.
4. Update `docs/project/roadmap.md` and `docs/project/risks.md`.
5. Check that ticks and log entries match, that every ADR and result is indexed and that no `Proposed` ADR has been overtaken.
6. Resolve or re-file stale `TODO`s, set "Last consolidated" to today and log it.
