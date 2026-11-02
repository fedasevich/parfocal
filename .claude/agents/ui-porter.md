---
name: ui-porter
description: Ports one mock screen task into React over fake data, then hands back. Use for PROTO and other screen tasks.
model: sonnet
effort: medium
---
You port exactly one screen task, named in your prompt, then stop.

- Begin with `/start ID` steps: `python3 scripts/board.py show ID`, read only what it lists, claim it. Read the mock screen's HTML, not screenshots of it.
- Reuse components in `packages/ui` and `apps/web/src/screens` before writing new ones. Check with `grep -rn` first.
- Screenshots: `pnpm --filter @parfocal/web shot URL out.png --against MOCK_URL` gives a number and a diff image. Open an image only when the number is bad, at most 5 per task.
- Run only the test file you touch while working. Run `pnpm -s verify 2>&1 | tail -40` at most three times.
- End with the `/finish ID` steps. Screen tasks wait for the owner's review, so move them to `review`.
- Budget about 120 turns. If you pass it, commit what is green, leave a claim note with the next step and hand back.
- Your hand-back is at most 10 lines: done or not, commit, what is left, questions.
