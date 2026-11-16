# XXXX. Main path budgets for the thesis are a 95th percentile after a warm-up, CI keeps the fastest of several

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: TEST-019 (application performance on main paths). Builds on [ADR 0154](0154-performance-budget-file-and-regression-rule.md) (one budget file, byte and count budgets fail at 20 percent, time budgets declare headroom) and [ADR 0114](0114-thesis-assignment-tasks.md) (tasks the thesis assignment adds).

## Context

The thesis asks for the performance of six main paths of the application, each against a budget fixed before measuring, with runs repeated after a warm-up and the median and p95 reported. ADR 0154 asserts time budgets in CI on the fastest of three samples, because load on a shared runner only adds time. A fastest sample says nothing about what a user sees on a bad run, and a p95 asserted on a shared hosted runner fails on noise.

## Options considered

1. Assert the p95 in CI. Honest to the thesis wording, but a shared runner with software rendering moves the tail by a factor of two or more, so the check would be flaky.
2. Report the median and p95 of a manual run against a fixed thesis budget, and keep the CI checks on the fastest of several with a declared headroom, as ADR 0154 says.
3. Report only the fastest sample everywhere.

## Decision

Option 2. Each main path has a `manual` budget in `perf-budgets.json` whose limit is the thesis target for the p95, written before the first measured run. The same harnesses run in a thesis mode, switched on by an environment variable, that does one warm-up and then a fixed number of runs and prints every sample with the median and the nearest-rank p95. The CPU-side paths also have CI budgets of kind `ms` under ADR 0154.

## Consequences

- The thesis numbers come from a named machine and run, and a regression in CI is still caught by the fastest-of-several checks.
- With few runs the nearest-rank p95 is the slowest run, and the result file says so.
- A thesis budget changes only by a reviewed edit, and its first value is in the commit that added it.
