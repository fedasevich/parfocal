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
| Tasks and ticks in total, per milestone gate and per epic | `python3 scripts/board.py counts` |
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

## Plan usage limits

The owner's Claude plan has a 5-hour and a weekly limit. The status line records both in `~/.claude/usage/latest.json`, and `scripts/guard_usage.py` runs as a hook in this project after every prompt and tool call.

- Run `python3 scripts/guard_usage.py` before spawning agents or starting a long task to see both limits and any override.
- At 80% the hook asks for cheap actions. At 90% finish the current step, start nothing new and record the next step. At 95% stop: note where you stopped with `board.py note`, commit and push only green work, tell the owner and end the turn.
- Only the owner turns on the override, by typing `! python3 scripts/guard_usage.py override [hours]` in the prompt. Without a number of hours it lasts until the 5-hour window resets, and `off` ends it. A hook blocks agents from running it or writing the override file, so never try to get around that.

## Picking the next task

Advice from Fable on 2026-11-02, accepted by the owner. Since decision 81a (staging before more features) of 2026-11-13, the staging slice comes before everything else: OPS-001 (base infrastructure as code), OPS-002 (deploy definitions), SKEL-001 (staging environment exists), IAM-001 (identity provider setup as code), OPS-005 (continuous deployment) and SKEL-009 (CI deploys main to staging). Start no other new task until the real end-to-end specs pass on staging. Tasks already claimed, review follow-ups and fixes to `main` may finish. After that, take the first ready task that passes, in this order:

1. The annotation path (milestone MA), in the order [ADR 0237](../adr/0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) lists, with TASK-015 (check options) after TASK-013, PROTO-020 (annotate task screens over fake data) before SHELL-004 and ANN-032 (check state) and GUIDE-019 (guided check) after ANN-031 as [ADR 0238](../adr/0238-check-options-and-presets-on-annotate-tasks.md) adds, since 2026-11-04.
2. The thesis slice: the SKEL walking skeleton tasks, EVAL-002 (evaluation report page), EVAL-003 (exports) and PILOT-004 (pilot data onboarding).
3. An open task that a path or slice task depends on.
4. Else the highest "unblocks" count from `board.py ready --agent-only`, the smaller `Size` winning a tie.

`Idea:` tasks stay in the backlog but come last. At most one task that adds a migration runs at a time.

## Parallel runs

The way the owner runs a batch of tasks, used for the overnight run of 2026-11-02 (51 tasks) and after. When the owner says "run N tasks" or "use the limit until the reset", follow this without asking.

How many agents and which model:

- Frontend tasks (`apps/web`, `packages/ui`) go to Sonnet with high effort. Backend tasks (`apps/api`, `workers`, `infra`, migrations, measured work) go to Opus with medium effort. Nothing higher.
- Two agents at a time by default. When the queue is all Sonnet work, run up to five. Go back to two as soon as the 5-hour usage climbs faster than about 5% per merged task, or passes 60%.
- At most one task that adds a migration runs at a time. Never run two tasks that touch the same screen or fake API store, such as the bell and mentions, at once. Hold the second until the first merges.
- Pick tasks by [Picking the next task](#picking-the-next-task), quick wins and high "unblocks" counts first.

Stopping:

- When the owner names a stop time, such as "stop by 2 am" so the next 5-hour window starts when they need it, start no new agent that cannot finish before it, merge what hands back, push and stop.
- Otherwise follow [Plan usage limits](#plan-usage-limits). Agents stop starting at 80%. For a run that must go on past a reset, set a cron heartbeat after the reset and delete it when the run ends.

The lead worktree and its scripts, in `scripts/lead/`:

- All merges, notes, ticks and pushes happen in one detached lead worktree at `../parfocal-wt/lead`, which `env.sh` creates on first use. The main checkout only fast-forwards, so another session's uncommitted files there stay safe.
- `claim.sh ID...` claims in the lead and commits without pushing.
- Each agent runs with `isolation: "worktree"` and commits only on its own branch.
- `merge.sh ID BRANCH "log text" [review note]`:
  - It merges the branch, numbers any `XXXX-*.md` ADR, runs `pnpm install` and `pnpm -s verify`, writes the note and ticks the task. With a fourth argument it moves the task to review with that note instead.
  - It commits, removes the agent's worktree and branch, and prints `MERGED-OK`.
  - It stops with `MERGE CONFLICT` or `VERIFY FAILED` and leaves the fix to the lead.
- `push.sh` pushes. `merge.sh` calls it after every third merge, so CI runs in batches and failure emails stay few. Run `push.sh` before ending a run.

The agent prompt always says:

- Read the task with `board.py show ID` and only the docs it lists. Grep for what already exists and build on it.
- Run `pnpm install` first, and `uv sync` when Python is touched.
- Build the tests that the "Done when" line names, and compare screens with the mock by number.
- Name new ADRs `docs/adr/XXXX-short-title.md`, with a `# XXXX. Title` line and the `- Date:`, `- Status:`, `- Deciders:` and `- Backlog:` lines.
- Do not edit `docs/BACKLOG.md`, `docs/log.md`, `docs/decisions.md`, `docs/board/` or READMEs (except the results index). Do not claim, note, tick or push.
- Never use the word "verdict", and write no code comments.
- Use a distinct `PARFOCAL_E2E_PORT` from 5190 to 5199 and stop the dev server before finishing.
- Run `bash scripts/verify-changed.sh 2>&1 | tail -40` until it passes, and also run the browser specs the task touched. The lead's merge and CI run the full `pnpm -s verify`.
- Commit as `feat(ID): ...` and hand back in at most 10 lines with a log line.

What the lead does with a hand-back:

- If the "Done when" line is met, tick. If only CI or a deploy is missing, move the task to review or blocked with a note naming the wait.
- A real product choice goes into `docs/decisions.md` with a recommended option.
- Watch `main`'s CI between merges with `bash scripts/lead/ci.sh`, which prints every workflow of the pushed head and the last finished `ci` run, and fix a red run before starting more agents. A push to `main` no longer cancels the `ci` run in progress, so each finished run is a result, and the docs checks are a job under `ci-ok`. `scripts/lead/push.sh` does not wait, and a second push during one run still replaces a queued run, so push once per finished `ci` run: when `ci.sh` prints `WAIT ci`, wait before the next push.
- When the run ends, consolidate the docs memory ([Consolidation](#consolidation)), push and only then report. The README went three weeks without it once, while the board more than tripled its ticks.

## Tasks in review

Review is for what only the owner can give. A task "waiting for a green CI run on `main`" is ticked by the next session that sees a green `ci` run on `main` after the task's commit, with no owner step. A task waiting on another task goes back to waiting with a claim note naming it. Only a real choice goes to `docs/decisions.md`.

## Checks and output

- While working, run only the test file you touch. Before committing, run `bash scripts/verify-changed.sh 2>&1 | tail -40`, which lints the changed files and runs typecheck and tests only for the changed packages and their dependents. Run it at most three times per task. Leave the full `pnpm -s verify` to the lead's merge and CI.
- In a worktree agent, use one plain command per Bash call. Put anything with a heredoc, loop, `$(...)`, `;` chain or `sed -i` in a scratchpad script and run it as `bash path`, and change files with Write or Edit, because the harness refuses compound commands there.
- To wait for background work, use a Bash `until` loop or load Monitor with ToolSearch first. Never `sleep`. The tool name is `Bash`, capitalised.
- Commit headers are at most 100 characters, or commitlint fails the commit.
- `.claude/settings.json` sets `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` to 25, so a session compacts at about 250k of its 1M window. A long lead run keeps its state in the run plan and heartbeat, so compaction loses nothing.
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
3. Write the code and the tests the "Done when" line names, then run `bash scripts/verify-changed.sh`.
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

The lead does this at the end of every parallel run, after the last `push.sh` and before the report. Also do it when a milestone closes or when the owner asks. `/consolidate` runs it.

1. Read the log since the last consolidation with `board.py recent`.
2. Rewrite "In progress", "Where we are now" and "Next up" from scratch within the output budget. Write no task count by hand in `docs/README.md`, the roadmap or the risks. `board.py counts` prints them, and its per-epic lines say which milestone has started.
3. Move repeated or costly lessons into `docs/knowledge/`, merging into an existing topic file.
4. Update `docs/project/roadmap.md` and `docs/project/risks.md`.
5. Check that ticks and log entries match, that every ADR and result is indexed, that every task, decision and risk the README names still exists and is open, and that no `Proposed` ADR has been overtaken.
6. Resolve or re-file stale `TODO`s, set "Last consolidated" to today and log it.
