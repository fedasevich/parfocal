# 0295. The UI is built on the fake API first, and each area then switches to the real API as one step proven by shared specs

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: changes TEST-026 (core browser specs against the real API), TEST-038 (draft call ratchet) and OPS-017 (real backend for the draft screens). Refines [ADR 0135](0135-fake-data-through-the-api-client-with-msw.md) (fake data goes through the API client) and keeps [ADR 0273](0273-test-pyramid-and-ownership.md) (the test pyramid).

## Context

ADR 0135 lets screens run on draft calls that only the fake API answers, and expected each draft to be deleted when its route shipped. The UI moved much faster than the backend, so 28 draft operations remain, the fake's handlers hold behaviour that nothing compares with the API, and only 6 browser specs reach the real API. The owner found many screens that work in tests and are empty when deployed. There are no real users yet, production holds only the owner's test data ([ADR 0293](0293-production-only-until-the-first-real-user.md), production only until the first real user), and the owner wants to finish the UI on fakes before connecting the backend.

## Options considered

1. Wire each screen to a real route before its UI task is done. Keeps the fake small, but the UI waits on the backend, which is what ADR 0135 avoided.
2. Build all UI on fakes and switch everything to the real API at the end. Fast now, but every assumption the fake makes comes due at once, and the fake becomes an unwritten spec the backend must copy.
3. Build the UI on fakes, pin each planned call's contract and the expected behaviour in specs that run on both backends, and switch one product area at a time.

## Decision

Option 3, because it keeps the UI speed of option 2 and turns the switch into many small checked steps.

- A draft keeps its planned operationId, URL and Zod response schema, as ADR 0135 requires. That schema is the contract the real route must return.
- The core flows of each area carry a `@real` tag. Until the area switches they run on the fake in the web browser job. A UI task that adds a screen adds at least one `@real` spec for it.
- An area switches in one change: its routes are built, the client is regenerated, its drafts and fake branches are deleted, and its `@real` specs pass on the local stack with the real API.
- The draft count is reported, not enforced, while the UI is being built on fakes.

## Consequences

- TEST-038 (draft call ratchet) reports the count per area in `pnpm verify` and does not fail.
- TEST-026 (core browser specs against the real API) tags the core specs now and runs them on the fake. The real-API project runs each switched area.
- OPS-017 (real backend for the draft screens) becomes the switch, area by area, with the `@real` specs as each area's acceptance test.
- The Definition of Done in the backlog asks for a `@real` spec with each new screen.
- Harder: a `@real` spec may only assert what the real API will do, not details only the fake can produce, such as faker text.
