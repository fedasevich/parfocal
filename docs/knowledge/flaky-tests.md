# Flaky tests

A flaky test fails and then passes on a retry. Fix it at its cause first. Quarantine is the short-term fallback, never a place to leave a test.

## What CI does

- Playwright retries a failed test once in CI (`apps/web` and `packages/ui`). Other configs do not retry, so their failures stay red.
- In CI every Playwright config also writes a JSON report to `test-results/report.json`. After the e2e and browser jobs, `node scripts/flaky.ts extract` keeps only the tests that failed and then passed. They are printed in the job summary and uploaded as the `flaky-*` artifacts for 14 days. The job still passes, but the test is visible and counted.
- The `flaky-report` workflow runs every Monday. It downloads the artifacts of the last seven days of main, writes the report to its summary, checks the quarantine list and opens a GitHub issue with the table.

## Quarantine

1. Open a GitHub issue for the test.
2. Tag the test: `test("name", { tag: "@quarantine" }, async () => {...})`. Every Playwright config skips tests with that tag.
3. Add an entry to `flaky-quarantine.json` with the file, the exact title, the issue link, an expiry date at most 30 days away and the reason.

The guard tests in `scripts/flaky.test.ts` (run by `pnpm test:guards`) fail when an entry has no issue link, no reason, has expired, or does not match a tagged test, and when a tagged test has no entry. An expired entry therefore turns CI red until the test is fixed or the entry is renewed with a reason.

## Causes found so far

Timing and load, never bad logic: a minimap drag read once right after mouse up, an undo spec over its 30 second limit on a runner 1.6 times slower, a latency proxy check, an outline budget and a long-task assertion. Wait on an observable state with `expect.poll` or web-first assertions instead of reading once, and give timing budgets headroom for a slower runner.

A control that goes away on its own needs one step, not two. The undo toast lives 4 seconds, and two display panel tests waited for the toast and then clicked a bare Undo button, which was detached in between on a slow runner (TEST-029, display panel specs click the Undo of the toast they caused). Find the button inside the toast that names what was done and click it in the same locator, so Playwright retries the whole lookup.

Before changing a flaky spec, check that its failing run is older than its last fix. On 2026-11-09 the `worklist-live` test and the `auto-region` long task budget each sat in one `flaky-*` artifact, and both runs came before the commits that had already steadied them (54be52fe and 663ab37f), so neither needed a second change.

One cause is still unknown: the table Tab order test in `packages/ui` fails its first ci attempt and never fails on the Mac (TEST-030, find why the table Tab order test fails on its first ci attempt).
