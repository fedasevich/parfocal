# 0010. GitHub Actions with hosted runners and a nightly self-hosted Mac GPU runner

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-038. Touches FOUND-007, STACK-012, TEST-015, TEST-018 and every task whose tests run "on the GPU runner".

## Context

STACK-038 picks the CI provider and runners and lists which suites run on every pull request, nightly and before release. GitHub Actions already runs the `docs`, `infra` and `ci` workflows. The repository `fedasevich/parfocal` is public under a personal account, so standard hosted runners are free without a minute limit.

Viewer tasks need golden-image, WebGPU and performance suites. On 2026-10-06, GitHub's GPU larger runners were only available to organisations on the Team or Enterprise Cloud plans and were billed per minute even for public repositories (https://docs.github.com/en/enterprise-server@3.17/billing/reference/actions-runner-pricing). GitHub's standard Apple Silicon runners give tests no GPU access.

## Options considered

1. Provider: GitHub Actions (already in use, free for this public repository, native pull request checks), GitLab CI or Buildkite (a second platform for no gain).
2. Real-GPU suites: a self-hosted runner on the owner's MacBook (real Apple GPU and headed Chrome with WebGPU, free, but a public repository must never run pull request code on it), software rendering only (SwiftShader on hosted Linux, deterministic and free, but no real-GPU performance numbers), or a paid GPU runner service (real NVIDIA GPU, per-minute cost and another vendor).

## Decision

GitHub Actions with standard hosted Linux runners for every pull request, and a self-hosted runner on the owner's Mac for real-GPU suites, run nightly and on demand from `main` only. The owner chose the Mac runner on 2026-10-06.

| Suite | Pull request | Push to `main` | Nightly | Before release | Runner |
|---|---|---|---|---|---|
| Secret scan, Biome, Oxlint, Ruff | yes | yes | | yes | hosted Linux |
| TypeScript and basedpyright typecheck, typecheck guard | yes | yes | | yes | hosted Linux |
| Unit tests, TypeScript and Python | yes | yes | | yes | hosted Linux |
| ADR check, OpenTofu validate | when `docs/` or `infra/` change | yes | | yes | hosted Linux |
| API contract and generated client check (FOUND-008) | yes | yes | | yes | hosted Linux |
| Container and Modal image build (FOUND-015) | yes | yes | | yes | hosted Linux |
| Dependency and licence scan (FOUND-014) | yes | yes | weekly | yes | hosted Linux |
| Component tests | yes | yes | | yes | hosted Linux |
| Golden images, software rendering (SwiftShader) | yes | yes | | yes | hosted Linux |
| E2E against the preview environment | yes | | | yes | hosted Linux |
| Golden images on a real GPU | | | yes | yes | Mac GPU runner |
| WebGL and WebGPU performance, frame-time budgets, 20-slide memory test | | | yes | yes | Mac GPU runner |
| Cross-browser matrix (TEST-015) | | | yes | yes | hosted Linux and macOS |
| Load and soak tests (TEST-010, OPS-012) | | | | yes | hosted Linux against staging |

"On the GPU runner" in a task's "Done when" line means the Mac runner's nightly or pre-release run.

Rules for the Mac runner:

1. Workflows that target it trigger only on `schedule` and `workflow_dispatch`, and each job checks `github.ref == 'refs/heads/main'`. No `pull_request` or `pull_request_target` workflow may use its labels.
2. The repository requires approval before workflows run for outside contributors.
3. The runner uses the labels `self-hosted`, `macOS`, `gpu` and runs as a separate macOS user without access to the owner's files or keychain.
4. Results go to a result file when a budget is set or changes, as `AGENTS.md` requires.

## Consequences

- Real-GPU regressions show up the next morning, not on the pull request. Golden images on SwiftShader catch most rendering changes before merge. STACK-012 confirms SwiftShader golden images with its spike.
- The Mac must be on and online for nightly runs. A missed night is reported, not silently skipped.
- TEST-018 sets up the runner when the first real-GPU suite exists.
- If the repository becomes private, standard runner minutes become limited. Revisit the schedule then.
