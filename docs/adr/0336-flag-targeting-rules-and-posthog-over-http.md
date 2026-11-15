# 0336. Flags target by workspace, role and user in one shared file, and PostHog answers over plain HTTP

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: EXP-001 (feature flag service integration), EXP-004 (layout experiments)

## Context

ADR 0296 (local flag layer behind an interface) built a hash split per user in the browser and left the PostHog adapter and targeting to EXP-001. EXP-001 asks for flags evaluated on the server and in the browser, per tenant, role and user, with a kill switch. No PostHog account exists, no SDK is installed and no test may call PostHog. ADR 0274 (ids-only analytics) says PostHog's own `$feature_flag_called` event must not bypass the schema, and ADR 0171 (analytics without device storage) forbids device storage.

## Options considered

1. Install `posthog-js` and `posthog-python` and let their rule engines decide. The SDKs store state on the device unless configured, send `$feature_flag_called` by default and cannot run in tests without a network or a deep mock.
2. Keep our own rule engine for the flag file in both languages and ask PostHog only for an override map through its `/flags/?v=2` HTTP endpoint, with the transport injected.
3. Evaluate only on the server and have the browser fetch arms from the API. One engine, but a new endpoint and a round trip before the first screen.

## Decision

Option 2. A flag in `apps/web/src/flags/flag-defaults.json` keeps `arms`, `default` and `mode` and may add `killed` and ordered `rules`. A rule names an arm and any of `users`, `workspaces` and `roles`. Every condition a rule names must hold, a list matches when it holds the value, and the first matching rule wins. User and workspace values must be pseudonymous ids.

Evaluation order, the same in `targeting.ts` and `parfocal_common/flags.py`: a killed flag returns its default, then a PostHog `false` returns the default (the runtime kill switch), then a PostHog variant that is one of the flag's arms wins, then the first matching rule, then the hash split, then the default. Each answer carries its reason. Only a split or a PostHog variant counts as an assignment and records `experiment_exposed`, because a person placed by a rule was not randomised.

The PostHog request carries the user id as distinct id, the workspace id as the `workspace` group and the sorted role names, nothing else. Any error or unknown value falls back to the local answer. A shared vector file, `packages/py-common/tests/fixtures/flag-targeting-vectors.json`, is checked by both test suites so the two engines cannot drift. In the browser, `Experiments.arm` is typed by `flagCatalogue`, so EXP-004 gets its arm names checked at compile time.

## Consequences

- No SDK, so no `$feature_flag_called`, no device storage and no network in tests.
- A PostHog outage leaves every flag on its local answer.
- The browser fetches the override map once per session and the server per call. A cache on the server is a later step if latency shows.
- TODO: the owner creates, in the PostHog EU project, the group type `workspace` and one multivariate flag per catalogue key with the same variant names, starting with `lab_lead_default_home` (`control`, `status_board`). Production wiring needs the project key as a setting.
- The flag file has two copies of the arm names, the JSON and `flagCatalogue`, and a test keeps them equal.
