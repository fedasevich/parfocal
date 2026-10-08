# 0014. Conventional Commits with backlog scopes, and releases cut locally with git-cliff

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-017

## Context

FOUND-017 asks for enforced Conventional Commits and a changelog per release tag. Commits so far read `FOUND-016: Add slide fixtures`, which names the backlog task but carries no change type, so no tool can derive a version from them. The owner pushes straight to `main` without pull requests, so any flow that depends on merging release pull requests adds a step the owner does not use. The owner asked for the app to be versioned and does not mind which library versions are used. Versions were checked on 2026-10-08.

## Options considered

1. Commit format: Conventional Commits with the backlog ID as the scope (`feat(FOUND-017): Add release versioning`), or keep `FOUND-017: Add …` and check it with a custom pattern. Only the first lets standard tools pick the version bump and changelog section.
2. Commit check: commitlint 21 (the common choice, installed through pnpm, runs in the hook and in CI), cocogitto (one Rust binary that also bumps and writes changelogs, but every machine and CI needs a separate install), or a small custom script (no dependency, but every rule is ours to maintain).
3. Versioning and changelog: git-cliff 2.14 with a local `pnpm release` script and a tag workflow (installed through pnpm, computes the next version from commits, works with direct pushes), release-please (keeps a release pull request open and tags when it merges, which needs pull requests and permission for Actions to open them), semantic-release (releases on every push to `main`, built around npm publishing), or Changesets (a file per change and versions per package, made for libraries).
4. Version scheme: one version for the whole product, or a version per package. The web app, edge, API and workers deploy together, so per-package versions would only add noise.

## Decision

| Concern | Choice |
|---|---|
| Commit format | Conventional Commits. The scope is the backlog ID when there is one, in its usual upper case, and several IDs are separated by commas. Subjects keep sentence case. `chore(release): vX.Y.Z` marks release commits |
| Enforcement | commitlint with `@commitlint/config-conventional`, with `scope-case`, `subject-case` and the body and footer line limits switched off. lefthook runs it as a `commit-msg` hook, and the `lint` CI job checks every commit a push or pull request adds |
| Versions | One SemVer version for the product, kept only in git tags `vX.Y.Z`. The first release is `v0.1.0`. While in 0.x, `feat` bumps the minor version, everything else the patch version, and breaking changes do not jump to 1.0 |
| Changelog | git-cliff, configured in `cliff.toml`. `pnpm release` checks for a clean `main` that matches `origin/main`, computes the next version, rewrites `CHANGELOG.md`, commits it and creates an annotated tag. Pushing with `git push --follow-tags origin main` starts the `release` workflow, which creates a GitHub release with that tag's section as its notes |

Commits from before this decision do not follow the format and are left out of the changelog.

## Consequences

- Every commit message changes shape, and the agent guide now says so. A commit with a bad message fails in the hook. A pushed one turns the `lint` job red, but because the owner bypasses the ruleset with direct pushes, CI can only report it.
- The app's version lives in tags, so a build that needs it reads `git describe --tags`. The `package.json` and `pyproject.toml` versions stay at `0.0.0`.
- Releases are a deliberate local step. Nothing is published until a tag is pushed.
- Tested on 2026-10-08: the hook rejected `Tick FOUND-017`, `pnpm release` refused a dirty tree, and `scripts/release-config.test.ts` checks accepted and rejected messages, the version bumps and a two-release changelog in a temporary repository.
