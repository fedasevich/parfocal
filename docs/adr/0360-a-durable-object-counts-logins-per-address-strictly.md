# 0360. A Durable Object counts logins per client address strictly, behind the approximate binding

- Date: 2026-11-16
- Status: Accepted
- Deciders: agent (SEC-027 follow-up asked by the run coordinator)
- Backlog: SEC-027

## Context

SEC-027 (edge limits per IP) limits login to 10 a minute per address with Cloudflare's rate limiting binding ([ADR 0088](0088-rate-limits-in-postgres-and-at-the-edge.md), rate limits in Postgres and at the edge). On production, 30 sequential logins from one address in 23 s all passed ([result](../results/2026-11-16-edge-rate-limits-production-check.md)). Cloudflare documents the binding as approximate and counted per location from a locally cached count, and names a Durable Object as the way to get a strict limit. Login is the one route where a strict count matters, because it guards password guessing and sign-in floods. Tiles and uploads need volume limits, where the binding's slack does no harm.

## Options considered

1. Keep the binding only. Free and fast, but the production check shows it does not stop a slow flood.
2. A Durable Object per client address for login, with the binding left in front. Exact within one object, which lives in one place for that address, costs one Durable Object request per login, which is far below the included allowance, and reuses the Worker's existing Durable Object setup.
3. A Cloudflare WAF rate limiting rule on the zone. Strict enough, but it lives outside the repository in the zone's settings, the free plan allows one rule with a fixed 10 s period, and changing it is a production settings write rather than a code change with tests.
4. Count logins in Postgres through the API, like ADR 0088 does per person. Exact, but the API sits on Modal and scales to zero, so every refused flood request would still wake a container and touch Neon.

## Decision

Option 2. `LoginCounter` in `apps/edge/src/login-counter.ts` is keyed `login:<address>` and keeps the times of the last allowed logins in a sliding 60 s window. The eleventh login inside the window gets the 429 `rate-limited` problem with `Retry-After` set to the seconds until the oldest counted login leaves the window. Refused logins are not counted, so a flood cannot push the window forward. Each allowed login sets an alarm one window ahead that deletes the object's storage, so no address is kept longer than a minute after its last login. The `LOGIN_LIMIT` binding still runs first and sheds large floods before they reach a Durable Object. The callback route counts in the same object as the login start, as it did with the binding.

## Consequences

- The Worker gains a second Durable Object class, bound as `LOGIN_COUNTER` in every Worker block, and a `v2` migration. The first deploy creates it.
- Each login costs one Durable Object request and a write of at most ten numbers.
- The object for an address is placed near the first login it sees, so a client far from it pays one extra round trip per login.
- Upload and tile limits stay approximate. If a strict limit is ever needed there, the same pattern applies.
- The production check from one address runs again after the next deploy. The second-address half still needs an IPv6 client.
