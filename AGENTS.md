# Agent guide

Read by Codex and other agents as `AGENTS.md` and by Claude Code through `CLAUDE.md`. Edit only this file. Keep it short, because every session and every subagent loads it. Procedures you need only sometimes live in [docs/knowledge/agent-workflow.md](docs/knowledge/agent-workflow.md).

## The project

Parfocal (`parfocal.eu`) is a multi-tenant cloud platform where researchers evaluate AI results on whole slides and doctors review them ([ADR 0053](docs/adr/0053-ai-results-review-direction.md), the AI results review direction). React with TypeScript in `apps/web`, `apps/edge` and `packages/*`, Python in `apps/api` and `workers/*`, OpenTofu in `infra/tofu`. The [root README](README.md) has the commands. The build follows `docs/BACKLOG.md` through milestones M0 to M6. It is also the practical part of the owner's master's thesis, whose material lives only in the private repository `fedasevich/parfocal-thesis`.

The design source is the approved prototype pair and the frozen mock in `docs/design/`. The archived POC is reference only ([docs/project/poc-reference.md](docs/project/poc-reference.md)). Read it for ideas and tuned constants, write fresh code, never modify it and never copy whole modules.

## Memory lives in docs/

Anything not written in `docs/` is forgotten by the next session. `docs/log.md` is append-only raw memory. `docs/README.md`, `docs/project/` and `docs/knowledge/` are rewritten to stay short and current.

Never read `docs/BACKLOG.md` or `docs/log.md` whole. Use `scripts/board.py` (`brief`, `show ID`, `find`, `recent`, `ready`, `note`, `tick`). A hook blocks whole reads.

## The task loop

1. Start with `/start ID`, or run `python3 scripts/board.py show ID`. Check that its dependencies are ticked, read only the ADRs, knowledge files and POC refs it lists, and claim it.
2. Build it with the tests its "Done when" line names. Untested work is not done.
3. Finish with `/finish ID`: run `pnpm -s verify`, add a log entry with `board.py note`, tick the task or move it to `review`, add an ADR, result or knowledge entry if one is due, stage files by name, commit and push.

Write an ADR for every choice between real alternatives that is costly to undo. Write a result file for everything measured, and never invent a number. Put every open question for the owner in `docs/decisions.md`, never only in chat. Formats are in [agent-workflow.md](docs/knowledge/agent-workflow.md).

## Working rules

- One backlog task per change. Respect "Depends on" and the Definition of Done in `docs/BACKLOG.md`.
- Build the obvious. When a behaviour is plainly needed, such as the camera stopping at the slide edge, build it, reusing the POC's tuned constants, and name it in the log. Add a backlog task when it is bigger than the current one. Ask the owner only about real product choices.
- Viv is the primary renderer and must work perfectly. Alternates sit behind the renderer interface and pass the same golden-image tests.
- Read every POC-supported format natively. Convert only when an ADR-recorded trigger fires.
- No PHI in logs, analytics, committed fixtures or docs.
- Never use the word "verdict" anywhere in the app: screen text, exports, audit names, API paths, code, tests and fakes. Say "decision" (agree, disagree or unsure), as [ADR 0072](docs/adr/0072-decisions-reasons-and-opinion-forms.md) does. FOUND-024 renames what already exists.
- When a task is finished, commit and push everything that belongs to it in the same turn without being asked. Stage by name. Never push failing work, never force-push, never rewrite pushed history.
- Commit messages are Conventional Commits with the task ID as scope, such as `feat(FOUND-017): Add release versioning` ([ADR 0014](docs/adr/0014-conventional-commits-and-releases.md)). No attribution lines.
- Respect the plan usage hook. Wrap up at 90% and stop cleanly at 95% of the 5-hour or weekly limit unless the owner turned on the override ([agent-workflow.md](docs/knowledge/agent-workflow.md#plan-usage-limits)).
- Keep tokens low. One task per fresh subagent, at most two alive, about 120 turns each. Run checks two or three times per task and pipe long output through `tail`. Take few screenshots, compare them with the mock by number (`shot --mock`) and open an image only when the number looks wrong. A hook allows 5 images per agent. Details are in [agent-workflow.md](docs/knowledge/agent-workflow.md).

## Real infrastructure and production

The owner pays for every service personally, and production will hold real data. A wrong command can lose data, leak it or run up a bill, and a revert undoes none of that. The policy is [ADR 0115](docs/adr/0115-production-access-and-spend-caps.md) (production access and spend caps) as changed by ADR 0151. Services, caps and access are in [knowledge/platform.md](docs/knowledge/platform.md) and [knowledge/agent-tooling.md](docs/knowledge/agent-tooling.md).

- Production means Modal environment `main`, the Neon main branch, the R2 buckets `parfocal-prod` and `parfocal-tfstate`, DNS and settings of the `parfocal.eu` zone, the Zitadel instance with its `parfocal-api-prod` app and organisation settings, any `tofu apply`, GitHub repository settings, secrets and rulesets, and every billing, plan or limit setting anywhere.
- Reading production is allowed: lists, logs, usage pages and `tofu plan`.
- The owner gave one standing yes for all sessions and subagents ([ADR 0151](docs/adr/0151-standing-approval-for-production-within-30-dollars.md), standing approval within $30 a month). Additive production writes need no question: `tofu apply` with no destroy or replace, deploys, migrations that only add, and new settings or secrets.
- Still ask in chat, one action at a time, showing the exact command or plan diff and its cost: anything that deletes, destroys, replaces, purges, rotates or resets, any migration that drops data, raising a limit, a payment method, a plan change, accepting terms, and anything that would take the month past budget.
- The whole project runs on $30 a month, the compute Modal includes. Nothing runs all the time in production, it scales to zero, and GPU work runs only on demand.
- Do what you can in dev or staging first, and delete what you created for a test when it ends.
- Every billing service has a hard cap or an alert, and a new one gets it on its first day with a row in `knowledge/platform.md`.
- Log every production touch and every cloud run's cost, or `TODO`, in `docs/log.md`.
- If anything looks wrong, such as an unexpected charge, a resource you did not create or a plan that replaces or destroys something, stop and tell the owner.

## Style

The code and writing rules (no code comments, no dashes, plain sentences, every ID followed by plain words) live once, in the owner's `~/.claude/CLAUDE.md`, which Claude Code loads in every session. Other agents read that file before writing.

- English and Markdown with relative links. File names in lowercase kebab-case, dates as `YYYY-MM-DD`.
- Name a group of tasks by its purpose instead of listing every ID.
- Short over long. Respect the output budget in [agent-workflow.md](docs/knowledge/agent-workflow.md). Mark open questions with `TODO`.
