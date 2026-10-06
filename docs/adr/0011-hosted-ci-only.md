# 0011. Hosted CI runners only, no GPU-heavy test suites

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-038. Supersedes [ADR 0010](0010-ci-runners-and-suites.md). Edits STACK-012, SKEL-006, AISEG task with the pointer-to-outline latency check, VIEW-005, VIEW-028, VIEW-029, VIEW-039, VIEW-040, AINUC-011, MLEVAL-005, MLEVAL-009, TEST-005, TEST-006, TEST-007, TEST-018 and the Definition of Done.

## Context

[ADR 0010](0010-ci-runners-and-suites.md) planned a self-hosted runner on the owner's Mac for real-GPU suites, run nightly and never on pull requests. The repository is public. Anyone can open a pull request that adds its own workflow targeting a self-hosted runner's labels, so the "nightly only" rule in our own workflow files does not protect the machine. GitHub's documentation warns against self-hosted runners on public repositories for this reason. The owner decided against any self-hosted runner and against test suites that need heavy GPU work.

## Options considered

1. Keep the Mac runner and make the repository private or require approval for outside contributors. Reduces the risk but still runs CI jobs on the owner's laptop, and the owner rejected it.
2. Hosted runners only. Every automated suite runs on GitHub's free hosted runners with software rendering, and anything that needs a real GPU becomes an occasional manual measurement.

## Decision

Option 2.

| Kind of check | Where and when |
|---|---|
| Secret scan, Biome, Oxlint, Ruff, typechecks, unit tests, contract checks, image builds, dependency scans | Hosted Linux on every pull request and push to `main` |
| Golden images | Headless Chromium with SwiftShader software rendering on hosted Linux, every pull request. STACK-012's spike confirms the setup and per-format tolerances |
| CPU-side performance budgets (time to first image, time to sharp after a jump, heap ceiling, hit-test time, request counts, bundle sizes) | Hosted Linux, on every pull request or nightly, as the task says |
| Memory and leak suite | Hosted Linux with software rendering, nightly |
| Cross-browser matrix | Hosted Linux and macOS runners, nightly |
| GPU-time and frame-rate budgets, renderer head-to-head benchmark | Manual run on the owner's Mac before the M2 gate and when a change targets rendering speed, recorded as a result file |
| ML throughput and evaluation on GPUs | On demand on Modal, before a model is promoted, recorded as a result file. Never on a schedule |
| Load and soak tests | Hosted Linux against staging, before a release |

No workflow uses `runs-on: self-hosted`. A "perf test" in a task's "Done when" line means a CPU-side test in CI, unless the task says it is a manual measurement.

## Consequences

- Real-GPU regressions are found by manual runs, not automatically. Golden images on software rendering still catch most rendering changes before merge.
- TEST-018 is dropped. The tasks listed at the top were edited to match.
- GPU spend on Modal stays tied to deliberate evaluation runs.
