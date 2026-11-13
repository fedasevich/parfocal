# 0296. Flags and experiments sit behind a small interface with a local, deterministic implementation first

- Date: 2026-11-13
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: STACK-033 (feature flags, experiments and product analytics), EXP-001 (feature flag service integration)

## Context

ADR 0003 (pilot platform architecture) names PostHog Cloud for flags and experiments. ADR 0005 (external sends only in production) says other environments read flag defaults from a local file. ADR 0171 (analytics without device storage) allows measuring only by pseudonymous user id. ADR 0274 (analytics events are a closed, ids-only list) says an exposure is a schema event. No PostHog account exists and none may be created yet.

## Options considered

1. Write the PostHog client first and test against a mock server.
2. Define a `FlagService` interface and a local implementation that reads `apps/web/src/flags/flag-defaults.json` and splits users by a hash, then add PostHog later behind the same interface.
3. Use only static flags with no assignment until PostHog exists.

## Decision

Option 2. A flag in the file has its arms, a default arm and a mode. In `default` mode everyone gets the default arm. In `split` mode the arm is chosen by hashing the flag key and the user id, so the choice is stable and balanced with no stored state and no device storage. A user id that is not a pseudonymous id (the id pattern of ADR 0274) is refused, so an email can never become the key.

The first exposure of a split flag per session goes through `eventSink` as `experiment_exposed` with only `flag` and `arm`, both from fixed lists in `eventSchema`. The user id travels as the distinct id of an `IdentifiedAnalytics` target, never as a property, and opt-out is checked before sending. This also answers the open point in ADR 0274: the exposure is listed in the schema, so PostHog's own `$feature_flag_called` event is not needed and EXP-001 turns it off.

## Consequences

- The local layer is the default in every environment outside production and a working fallback in production.
- The PostHog adapter is not built here. It becomes a second `FlagService` and an `IdentifiedAnalytics` that calls PostHog capture, with its tests using an injected fake transport.
- Adding a flag means editing the JSON file, `flagKeys` and `flagArms` in `events.ts`, and a test.
- Hash assignment cannot target by workspace or role. If the owner wants that, PostHog's own rules take over in production.
