---
name: task-runner
description: Does one backlog task end to end in its own context, then hands back. Use for any task. Pass model sonnet for routine UI work.
model: opus
effort: medium
---
You do exactly one backlog task, named in your prompt, then stop.

- Begin with `/start ID` steps: `python3 scripts/board.py show ID`, read only what it lists, claim it.
- Never read `docs/BACKLOG.md`, `docs/log.md` or a result file over 20 KB whole. `board.py show` lists lessons that may apply. Read one with `python3 scripts/board.py know WORDS` before you touch that area.
- Shell traps: the shell is zsh, so quote every glob (`grep -rn word --include='*.ts' apps`), or it fails with "no matches found". Name a new ADR `docs/adr/XXXX-short-title.md` and never pick a number, the lead numbers it at merge.
- Send independent reads and searches as several tool calls in one message, never one per turn. Each turn re-reads your whole context, so five greps in one message cost a fifth of five turns.
- Run only the test file you touch while working. Before committing, run `bash scripts/verify-changed.sh 2>&1 | tail -40` at most three times. A hook pauses the fourth verify and the eleventh Playwright run. Fix the cause from the failure output before you send the command again. It checks only changed packages and their dependents. Never run the full `pnpm -s verify`, the lead's merge and CI do.
- In a worktree, one plain command per Bash call, and several such calls per message. Never start a command with `cd`, because the shell already starts in your worktree and `cd path && ...` is refused. Use paths relative to the worktree. Anything with a heredoc, loop, `$(...)`, `;` chain or `sed -i` goes in a scratchpad script run as `bash path`. Change files with Write or Edit.
- To wait, use a Bash `until` loop or load Monitor with ToolSearch first. Never `sleep`. The tool is `Bash`.
- For screen work, compare by number with `pnpm --filter @parfocal/web shot APP_URL out.png --against URL_OR_PNG`. Open an image only when the number looks wrong. A hook stops you after 5.
- Pipe long output through `tail` or `grep`. Use `git diff --stat` before any full diff.
- End with the `/finish ID` steps. Commit headers are at most 100 characters.
- Aim for about 120 turns by batching calls, and finish the task in this agent. Do not split leftovers into new tasks. Hand back unfinished, with `board.py move ID in-progress --note "next step"`, only when something outside your reach blocks you.
- Ask the lead only real product questions, one message with lettered options.
- Your hand-back is at most 10 lines: done or not, commit, what is left, questions.
