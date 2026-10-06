# Agent guide

This file is read by Codex and other agents (`AGENTS.md`) and by Claude Code (through `CLAUDE.md`, which imports it). Edit only this file so every agent gets the same instructions.

## What this project is

Parfocal (`parfocal.eu`) is a multi-tenant cloud platform for pathologists. It covers whole-slide viewing, AI-assisted review and annotation, collaboration, reporting and sign-out. The frontend is React with TypeScript and the backend is Python. The build follows `docs/BACKLOG.md`, which takes an empty repository to a pilot-ready product through milestones M0 to M6.

The design source is the approved prototype pair, the UX kit (https://claude.ai/artifact/WKq3HJJWYL15oY4nXNBweC) and the hi-fi mock (https://claude.ai/artifact/3axrsHDKG5EqDyxu3nZYoJ). The archived POC is reference only. It lives at `/Users/yuriifedas/WebstormProjects/poc` and on GitHub at https://github.com/fedasevich/pathlogy-poc (private, branch `master`). If the local copy is missing, clone it with `gh repo clone fedasevich/pathlogy-poc /Users/yuriifedas/WebstormProjects/poc`. [docs/project/poc-reference.md](docs/project/poc-reference.md) lists every POC doc with full links. Read it to see how an idea was captured and what went wrong, then write fresh code here. Never modify the POC and never copy whole modules from it.

## The docs folder is the project memory

Everything the project knows, plans, decides and measures lives in `docs/`. Chat history, agent memory tools and session transcripts are not memory. If something is not written in `docs/`, assume the next session does not know it. External memory tools such as ai-memory may hold recall and session history, but they never replace or duplicate what belongs here.

### Before starting any task

1. Read `docs/README.md`, especially "Where we are now" and "Next up".
2. Read the top of `docs/log.md` for recent work.
3. Find the task in `docs/BACKLOG.md` and read its "Done when", "Depends on" and "Refs" lines. Check that its dependencies are ticked.
4. Check `docs/adr/` for anything already decided that touches the task. Don't reopen an accepted decision unless the user asks to.
5. Check `docs/knowledge/` for known gotchas in the area.
6. Read the POC files and docs named in "Refs". `poc/` paths and `doc NN` resolve as described in `docs/project/poc-reference.md`.

### After finishing a task

Update `docs/` in the same change as the code.

1. Add a dated entry to `docs/log.md` (newest on top). Name the backlog ID, say what was done, where the result is and anything surprising.
2. Tick the task in `docs/BACKLOG.md` only when its "Done when" line is fully true and the tests pass. If the task was split or changed, edit the backlog as its "How to use" section says.
3. If a choice was made between real alternatives, write an ADR (see below).
4. If anything was measured, write a result file (see below). Numbers never live only in a log line or a commit message.
5. If you learned something a later session must not rediscover the hard way, add it to `docs/knowledge/`.
6. If the milestone status, risks or scope changed, update the matching file in `docs/project/`.
7. Update "Where we are now" and "Next up" in `docs/README.md` when they no longer match reality.
8. If you added a new file, link it from the index it belongs to.

### When stopping mid-task

Write an "In progress" note at the top of `docs/README.md`. It names the backlog ID, what is done, what is left, the exact next step and any uncommitted or broken state. Remove the note when the task is finished.

## Memory consolidation

The log is raw memory. It is append-only and never edited except to fix a broken link. `docs/README.md`, `docs/project/` and `docs/knowledge/` are consolidated memory. They are rewritten so that they stay short and current.

Consolidate when a milestone closes, when the user asks, or when the log has gained about 15 entries since the date in "Last consolidated" in `docs/README.md`. To consolidate:

1. Read the log entries since the last consolidation.
2. Rewrite "Where we are now" and "Next up" in `docs/README.md` from scratch.
3. Move lessons that appear more than once, or that cost real time, into `docs/knowledge/`. Merge them into an existing topic file rather than starting a new one when the topic fits.
4. Update milestone status in `docs/project/roadmap.md` and the risk register in `docs/project/risks.md`. Close risks that no longer apply and add new ones.
5. Check that every ticked box in `docs/BACKLOG.md` has a log entry and every finished task in the log is ticked.
6. Check that every ADR and result file is listed in its index and that no `Proposed` ADR has been silently overtaken.
7. Resolve or re-file stale `TODO`s.
8. Set "Last consolidated" to today and add a log entry that says what was consolidated.

## Layout

| Path | Contents |
|---|---|
| `docs/README.md` | Index of all docs, "Where we are now", "Next up", "In progress" |
| `docs/BACKLOG.md` | Every task from empty repo to pilot, with checkboxes, the Definition of Done and the decisions baseline |
| `docs/log.md` | Dated, append-only log of what was done |
| `docs/project/overview.md` | The product, users, scope, design sources and the POC's role |
| `docs/project/roadmap.md` | Milestones M0 to M6 and their status |
| `docs/project/risks.md` | Risk register |
| `docs/project/poc-reference.md` | Where the POC lives, with full links to every POC doc |
| `docs/adr/` | Numbered architecture and product decision records |
| `docs/results/` | Spike numbers, benchmarks, perf baselines, ML evaluations, user studies |
| `docs/knowledge/` | Durable lessons, gotchas and how things work, by topic |

The code lives in `apps/web`, `apps/edge` and `packages/*` (TypeScript), `apps/api` and `workers/*` (Python) and `infra/tofu` (OpenTofu). The root [README](README.md) describes each folder and the commands to install, test and check.

## Decision records

Write an ADR whenever a choice between alternatives affects other code, other people or would be costly to undo. Every STACK task and every `xxx-000` research check ends in one. Typical examples are a library, a data format, an API contract, a security control or a change to the decisions baseline in `docs/BACKLOG.md`.

- Copy `docs/adr/0000-template.md` to `docs/adr/NNNN-short-title.md` with the next free four-digit number.
- Fill in the context, the options with their real pros and cons, the decision and why it won, the consequences and the backlog tasks it touches.
- Use status `Proposed` until the user agrees, then `Accepted`.
- Never rewrite an accepted record. To change course, write a new one and set the old one's status to `Superseded by NNNN`.
- When an ADR changes what a backlog task must do, edit that task in the same change and link the ADR from it.
- Add the record to the table in `docs/adr/README.md`.

## Results

Write a result file whenever something is measured, such as a spike, a benchmark, a perf or memory baseline, a model evaluation, a load test or a user study.

- Copy `docs/results/_template.md` to `docs/results/YYYY-MM-DD-short-topic.md`.
- Record the backlog ID, the commit, the environment (machine, OS, browser and version, GPU, dataset or fixtures) and the exact method so the run can be repeated.
- Put raw numbers in tables. Keep facts apart from interpretation and label assumptions as such.
- Compare against the budget or the POC number when one exists.
- Add the file to the table in `docs/results/README.md` and link it from any ADR that relies on it.

Never invent data. Do not make up benchmark numbers, model scores, user quotes, survey results or sources. If a number is needed and unknown, write `TODO` and say what would be needed to measure it.

## Working rules

- Work one backlog task per change. Respect "Depends on" and the Definition of Done in `docs/BACKLOG.md`.
- Every task ships with the tests its "Done when" line names. Untested work is not done.
- Viv is the primary renderer and must work perfectly. Alternates sit behind the renderer interface and must pass the same golden-image tests.
- Read every POC-supported format natively. Convert only when an ADR-recorded trigger fires.
- No PHI in logs, analytics, test fixtures committed to the repo, or docs.
- Commit only when the user asks. Do not add attribution lines to commit messages or pull request descriptions.

## Code style

Don't add comments of any kind to code (inline, block, docstrings, JSDoc) unless the user asks for them. Make the code self-explanatory instead.

## Writing style

These apply to everything written in this repository and in chat: docs, code, commit messages and pull request descriptions.

- Where an em dash or en dash would go, use a hyphen, comma or period, or rephrase.
- Write list items and paragraphs as plain sentences. Bold is fine for emphasis inside a sentence, but don't open an item with a bold label and a colon.
- Don't end a clause with a tacked-on participle such as ", enabling X", ", allowing X" or ", resulting in X". Use a relative clause or a new sentence.
- Join independent clauses with a period or a conjunction, not a semicolon.
- Write in English and Markdown with relative links. File names are lowercase kebab-case and dates are `YYYY-MM-DD`.
- Prefer short, plain sentences and tables over long prose. Mark open questions with `TODO` so they are easy to find.
