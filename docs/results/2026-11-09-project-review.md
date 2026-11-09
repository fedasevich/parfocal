# Result: project review of 2026-11-09

- Date: 2026-11-09
- Backlog: FOUND-033, FOUND-034, FOUND-035, FOUND-036, FOUND-037, FOUND-038, SEC-031, TEST-026, TEST-027 and TEST-028, each named under Follow-ups
- Kind: baseline
- Commit: 2ed39caa
- Environment: the owner's Mac, `gh` against `fedasevich/parfocal`, read-only
- Data: the repository, `docs/`, the GitHub Actions history and the agent settings. No cloud dashboard, no thesis repository and no line by line code review

## Question

What in the way the project is built is most likely to hurt it, and what would fix each problem.

## Method

Counts come from `grep` over `docs/BACKLOG.md`, `git ls-files` with `wc -l`, `gh run list` and `gh run view`, `scripts/check_adrs.py`, `scripts/board.py` and the settings files. Times are UTC.

## Results

| Measure | Number |
|---|---|
| Tasks in the backlog, ticked | 940, 664 |
| Commits since 2026-10-06 | 2,519, with 467 on 2026-11-09 |
| Environments that serve the app | 0. SKEL-001 (staging environment exists) is open and the OPS epic (infrastructure and operations) is 1 of 14 |
| Deploy definitions for `apps/api` | 0. The only Modal app is the ML pool in `workers/ml` |
| Stack tasks still waiting for a cloud number | STACK-019 (web framework, Modal cold starts) and STACK-020 (database hosting, the Neon measurement), free since 2026-10-31 |
| Browser specs on the fake API, specs on the real API | 165 in `apps/web/e2e`, 6 in `apps/e2e` |
| Hand-written fake handlers, draft operations with no backend | About 13,700 lines, about 50 files of draft hooks in `packages/api-client/src/draft` |
| `ci` runs on main on 2026-11-09 | 39: 3 green, 9 failed, 27 cancelled |
| `docs` workflow | Failed on every push from 13:00 to 18:14, 14 runs, 13 of them on `ModuleNotFoundError: No module named 'pytest'` in `scripts/test_load_target.py`. Green again on 053376fc |
| Push of 18:14 (ci run 42672338835) | `ci` failed with one job started, `docs` and `security` failed with none. Not explained. The next two pushes ran normally |
| `db` job | 2,680 tests in 21 min 22 s, one after another (ci run 42666737479) |
| Decision records | 242 checked by `check_adrs.py`, 214 accepted, 18 proposed. Three carry the number 0278 and `check_adrs.py` passes |
| The word "verdict" in `apps`, `packages` and `workers` | 994 hits in 106 files |
| Migrations | 91 files numbered up to `0110`, with no shared database yet |
| Largest source files | `tables.py` 3,053 lines, `full-viewer.tsx` 1,895, `steps.tsx` 1,627, `guided-review.tsx` 1,289 |
| Browsers in the Playwright configs | Chrome only, on SwiftShader in CI |
| Model tests in CI | The `weights` marker is deselected and the dataset tests skip, so none of the accuracy tests run there |
| Permission mode of the owner's sessions | `bypassPermissions`, no deny list. Connected MCP servers offer tools that delete a Neon project or branch and an R2 bucket |
| `docs/README.md` | Last consolidated 2026-10-18. It says 796 tasks with about 170 ticked |

## Interpretation

1. The largest risk is that nothing has run on the platform it was designed for. The picking order ranks ready tasks by how many they unblock, and OPS-001 (base infrastructure as code) unblocks one, so the staging slice never wins. Unproven on the cloud: the database driver behind the Neon pooler, tenant context through the pooled endpoint, the WebSocket upgrade into Durable Objects, the CSP nonce and isolation headers on a deployed Worker, and part copy on R2.
2. The fake API ties types to `openapi.json` but not behaviour, so a screen can pass 165 specs and still fail on the backend.
3. A red main goes unseen. Runs take 20 to 30 minutes, pushes come faster and a newer push cancels the running one, so most pushes never get a result, and the `docs` workflow sits outside `ci-ok`.
4. The production rules are prose. Nothing technical stops a session or subagent from a destructive cloud call.
5. Agents stood in for a pathologist (decision 44c) and for the people in the incident tabletop. That is fine for building and must be labelled before the thesis cites it.
6. The docs memory, which every session trusts, is three weeks behind the board.
7. No milestone has closed and none has a date, while the backlog grew from about 600 to 940 tasks.

## Follow-ups

- Fixed the same day: the `docs` workflow, by making `scripts/test_load_target.py` a unittest case (commit 053376fc).
- For the owner in [decisions.md](../decisions.md): decision 81 (staging before more features), decision 82 (what the thesis claims about people) and decision 83 (a date for the thesis slice).
- New tasks: FOUND-033 (a result for every push to main), FOUND-034 (guard against duplicate decision record numbers), FOUND-035 (squash the migrations into one baseline), FOUND-036 (split the largest source files), FOUND-037 (docs memory that cannot go stale), FOUND-038 (records where an agent stood in for a person), SEC-031 (hard stops for destructive agent actions), TEST-026 (core browser specs against the real API), TEST-027 (database tests in parallel) and TEST-028 (model accuracy tests that cannot be skipped unseen).
- Changed: FOUND-024 (rename verdict to decision everywhere) now says to land before the squash and before any production database.
- Already covered by an open task: Chrome-only browser tests, by TEST-015 (cross-browser matrix).
