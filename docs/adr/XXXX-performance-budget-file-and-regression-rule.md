# XXXX. One budget file at the repository root, byte and count budgets fail at 20 percent, time budgets declare headroom

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: TEST-006 (performance budget suite). Takes over the bundle budget SHELL-001 (routes and code splitting) left in `apps/web/bundle-budget.json` and the 1 s sidecar open INGEST-007 (sidecar tile index) asserted. Builds on [ADR 0011](0011-hosted-ci-only.md) (hosted CI runners only).

## Context

TEST-006 asks for budgets stored in one file with ADR links, run at several RTTs through the latency proxy, and done when a 20 percent regression on any CPU-side budget fails CI. Two budgets already lived in separate places with their own limits. CI runs on shared hosted Linux runners with SwiftShader, while every baseline so far was measured on an Apple M4. The latency proxy result of 2026-10-23 showed that medians fail on a loaded CPU and that the fastest of several samples does not, because load only adds time.

## Options considered

1. A limit of 1.2 times the baseline for every budget, times included. Honest to the letter of the task, but a time measured on an M4 then fails on a slower runner without any regression.
2. Byte and count budgets at 1.2 times the baseline. Time budgets keep a declared headroom of at most 3 with a written reason, take the fastest of three samples and assert at one RTT only, and are tightened once the hosted runner has a measured number.
3. Turn every time into critical-path round trips, the slope between two RTTs, so the 20 percent rule applies to times too. Robust to a slow CPU, but it hides a CPU regression and doubles the runs.
4. Log times only until a hosted-runner baseline exists.

## Decision

Option 2. `perf-budgets.json` at the repository root holds every budget with its kind, baseline, limit, environment, the test that checks it, an ADR and a result file. `scripts/perf-budgets.ts` loads it and `checkBudget` fails a test that goes over. `scripts/perf-budgets.test.ts` runs with the guards in CI and fails when a byte or count limit is more than 20 percent over its baseline, a time budget has no RTT, headroom or reason, a linked file is missing, or the named test never mentions the budget's id. Frame time and overlay GPU time stay manual and carry a `todo` until a result file sets them, as ADR 0011 requires.

## Consequences

- Requests and bytes to the fitted image and to sharp after a jump are deterministic, so they hold the 20 percent rule on any runner and catch most loading regressions, including a lost cache or a fetch storm.
- A 20 percent slowdown in pure CPU time can pass CI until the time limits are tightened from the hosted-runner numbers. TODO: record those numbers from the first browser CI run.
- Changing a limit is a reviewed edit of one file, and the guard test refuses a byte or count limit looser than the rule.
