# Result: flag and experiment assignment balance

- Date: 2026-11-13
- Backlog: STACK-033 (feature flags, experiments and product analytics)
- Kind: spike
- Commit: bd3cb767 plus the STACK-033 change
- Environment: Mac, macOS, Node test runner, no network
- Data: generated ids of the form `usr_` plus a base 36 counter, no real people

## Question

Does a local, deterministic split of pseudonymous user ids give two stable and balanced arms for the lab leads' default home experiment, and does the exposure event carry only the flag and the arm?

## Method

`apps/web/src/flags/assign.ts` hashes `flag key : user id` (FNV-1a with a murmur style finish) to a number in [0, 1) and picks the arm by position. The 100000 user run was a one off script over generated ids. The unit tests in `apps/web/test/flags.test.ts` check stability, balance with 20000 ids at a tolerance of 1.5 percentage points, independence between flags, the default mode, refusal of an email as user id, opt-out, and the exposure properties.

## Results

| Users | control | status_board | control share |
| --- | --- | --- | --- |
| 1000 | 516 | 484 | 0.5160 |
| 10000 | 5085 | 4915 | 0.5085 |
| 100000 | 50278 | 49722 | 0.5028 |

The same user got the same arm on every call. The exposure event had exactly two properties, `flag` and `arm`. The user id went only to the sink's distinct id slot and never into properties.

## Interpretation

The share shrinks toward one half as the sample grows, as a fair split should. This is a spike over generated ids, so it says nothing about how real ids are spread.

## Follow-ups

- ADR 0296 (local flag layer behind an interface) records the choice.
- TODO: the PostHog adapter is not written. No PostHog package is installed and no account exists, so it cannot be built or tested without a network call. EXP-001 (feature flag service integration) adds it behind `FlagService` and `IdentifiedAnalytics`.
- TODO: the home experiment is not wired into the home screen. A later change reads `experimentsFor(...).arm("lab_lead_default_home")`.
