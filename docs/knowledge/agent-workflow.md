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

- One task per fresh subagent, using `.claude/agents/task-runner.md`. Pass a different model when the table below says so. Never fork the main session for task work, because a fork carries its whole context.
- At most two task agents alive at once. Short read-only Haiku reviews may run about six.
- Budget about 120 turns. When a run passes it, or the work is plainly bigger than one task, the agent commits what is green, leaves a claim `note:` with the next step and hands back.
- The main session only picks tasks, spawns, relays questions and merges. End it after one epic or about three tasks and start fresh.

| Work | Model |
|---|---|
| Porting mock screens, routine UI, tests for existing code | Sonnet, medium effort |
| ADRs, research checks, backend design, security, tricky bugs | Opus |
| Board moves, index rows, log lines, simple doc edits | Haiku |
| Second opinion | Fable, once before starting and once before hand-back, never per turn |

## Picking the next task

Advice from Fable on 2026-11-02, accepted by the owner. Take the first ready task that passes, in this order:

1. The thesis slice: the SKEL walking skeleton tasks, EVAL-002 (evaluation report page), EVAL-003 (exports) and PILOT-004 (pilot data onboarding).
2. An open task that a slice task depends on.
3. Else the highest "unblocks" count from `board.py ready --agent-only`, the smaller `Size` winning a tie.

`Idea:` tasks stay in the backlog but come last. At most one task that adds a migration runs at a time.

## Two agents in parallel

- Each agent works in its own worktree, `git worktree add ../parfocal-wt/ID -b task/ID`, never in the main checkout.
- Lanes keep them apart. Opus takes `apps/api`, `workers`, `infra` and migrations, Sonnet takes `apps/web` and `packages/ui`. A task that touches both runs alone.
- The main session claims both tasks in one commit before spawning. Agents commit only on their branch and never run `note`, `tick` or push, because `docs/log.md` and `docs/BACKLOG.md` are where commits collide.
- When an agent hands back, the main session rebases its branch on `main`, runs `pnpm -s verify`, `note` and `tick`, and pushes. One merge at a time.
- Web Playwright runs use `CI=1` in a worktree so two runs do not share port 5183.

## Tasks in review

Review is for what only the owner can give. A task "waiting for a green CI run on `main`" is ticked by the next session that sees a green `ci` run on `main` after the task's commit, with no owner step. A task waiting on another task goes back to waiting with a claim note naming it. Only a real choice goes to `docs/decisions.md`.

## Checks and output

- Run `pnpm -s verify 2>&1 | tail -40` two or three times per task, not after every edit. While working, run only the test file you touch.
- Pipe long output through `tail`, `head -50` or `grep`. Never print whole generated files, lockfiles or full diffs. Use `git diff --stat` first.

## Screenshots

An image costs a lot and stays in context for every later turn. Take few screenshots and open fewer.

The mock comparison below is temporary. FOUND-022 (remove the mock comparison tooling) deletes it once PROTO-010 (make the React app the design source) is done.

- Read the mock's HTML and the code to know what a screen should show. Don't screenshot to find out.
- Compare by number: `pnpm --filter @parfocal/web shot APP_URL out.png --mock SCREEN/SCENE` shoots the app and the same mock scene at 720 by 450 in the same theme, then prints the share of pixels that differ and writes a diff image. Scene keys are in [design/prototype-inventory.md](../design/prototype-inventory.md), and a wrong key prints the valid ones. `--theme dark` compares the dark theme. `--against URL_OR_PNG` compares with any other page or image.
- Expect some difference, because fake data and fonts never match exactly (Home in the light theme differs on about 17%). Look at a screen only when its number is far above the others or jumps after a change.
- A hook in `.claude/settings.json` lets each agent open at most 5 images. After that it refuses, and the owner can raise `PARFOCAL_IMAGE_LIMIT` for a session.
- Leave pixel nits to the owner's review against the mock.

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
