# 0337. UI visual regression compares every story in both themes and densities with committed baselines from the Linux runner

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: TEST-008 (visual regression for UI). Builds on [ADR 0101](0101-golden-image-comparison.md) (golden images compared per channel on SwiftShader frames) and [ADR 0146](0146-frontend-testing-stack.md) (frontend testing stack)

## Context

TEST-008 asks for component stories in both themes and densities, and for a visual diff that blocks a pull request until someone approves it. The Storybook in `packages/ui` holds about 440 stories and is already built and served for the axe suite in the `browser (ui)` job. ADR 0146 proposed Playwright `toHaveScreenshot` for UI chrome. Paid services such as Chromatic or Percy are ruled out by the $30 budget ([ADR 0115](0115-production-access-and-spend-caps.md)). Text renders differently on a Mac, so baselines must come from the Linux runner, as the text goldens of TEST-005 (golden-image rendering tests) already do.

## Options considered

Comparison:

1. Playwright `toHaveScreenshot`. Built in, but it names snapshots per platform, keeps its own update flag and cannot express "compact may reuse the comfortable baseline".
2. The per-channel comparison of `packages/golden-images` with a UI tolerance, driven by a pure module. One diff engine and one diff image format for the repository, and the decision logic is unit tested without a browser.

Approval:

1. A pull request label that turns a failing diff green. Needs a second workflow and leaves the baselines stale.
2. Committed baselines. A diff fails `browser (ui)` and with it `ci-ok`. Approving means regenerating the baselines on the runner and committing them to the pull request, where the reviewer sees each changed PNG.

Densities:

1. A baseline for every story, theme and density, about 1,760 PNGs.
2. A compact baseline only where compact differs from comfortable. A compact frame without its own file is compared with the comfortable baseline of the same theme.

## Decision

Comparison option 2, approval option 2 and density option 2.

- `packages/golden-images/src/visual.ts` names the cases (`<story id>--<theme>--<density>`), resolves the compact fallback, finds stale baselines and judges each frame. `UI_TOLERANCE` allows a channel delta of 16, 0.1% of pixels past it and a mean error of 0.5 per channel. These are starting values, not measurements, and absorb anti-aliasing while still failing a changed one pixel border.
- Storybook gains a `density` global beside `theme`, which sets `data-density` on the root element.
- `packages/ui/e2e/visual.spec.ts` captures each story full page at 1280 x 800 with reduced motion, disabled animations and a fixed clock, in comfortable then compact, for both themes. Baselines live in `packages/ui/visual`. A mismatch writes `actual` and `diff` PNGs, which CI uploads as the `ui-visual-diff` artifact.
- While no baseline is committed the visual tests skip, so CI stays green until the first approval. Once any baseline exists, a missing or stale one fails.
- To approve, run `gh workflow run ci --ref BRANCH -f update_goldens=true`, then replace `packages/ui/visual` with the `ui-visual-baselines` artifact (`rm -rf packages/ui/visual` and `gh run download RUN -n ui-visual-baselines -D packages/ui/visual`) and commit it.

## Consequences

- Blocking relies on `ci-ok` being a required check on `main`. TODO: the owner confirms that the ruleset requires `ci-ok`, since agents do not change rulesets.
- TODO: the first `update_goldens` run on the runner writes the first baselines, and the owner reviews them before they are committed. The repository size of the set and the time the spec adds to `browser (ui)` are measured then.
- A story that renders differently between runs goes into the `unstable` map of the spec with a reason, as the axe suite keeps its exclusions.
- A Chrome update on the runner image that moves text pixels past the tolerance fails every story at once. The fix is one approval run.
