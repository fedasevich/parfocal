# Result: realtime events reach two browsers in about 60 ms through a Durable Object room on workers.dev

- Date: 2026-11-02
- Backlog: STACK-024 (realtime transport)
- Kind: spike
- Commit: the STACK-024 commit that adds `apps/edge/wrangler.jsonc`, `apps/edge/src/worker.ts` and `apps/edge/spike/realtime-latency.ts`, on top of the COLLAB-001 (realtime infrastructure) rooms
- Environment: Apple M4 MacBook running macOS 15, Google Chrome 156 headless through Playwright 1.64, home broadband, wrangler 4.156.2. The Worker `parfocal-edge-dev` ran on Workers Free at `parfocal-edge-dev.yurafedasevka.workers.dev`, signed with a throwaway room key, and was deleted after the run
- Data: random UUIDs for tenant, project, slide, thread and users. No real data

## Question

Does the default of [ADR 0003](../adr/0003-pilot-platform-architecture.md) (pilot platform architecture), Durable Objects with WebSocket Hibernation as built in [ADR 0140](../adr/0140-realtime-rooms-and-room-tokens.md) (realtime rooms and room tokens), carry a presence event and a thread update to two browsers in under 300 ms on a deployed Worker?

## Method

1. `npx -y wrangler@4 deploy` from `apps/edge`, then `wrangler secret put ROOM_TOKEN_KEY` with a random 32-byte key.
2. `node spike/realtime-latency.ts --url https://parfocal-edge-dev.yurafedasevka.workers.dev --rounds 30`, run three times. It reads the same key from `apps/edge/.dev.vars`, which git ignores. The measured runs passed the URL, rounds and key as environment variables instead, and the script changed to arguments afterwards only to satisfy the linter. The measurement is the same.
3. The script launches two separate Chrome browsers. Each joins `/rt/slide:{id}` with its own room token for another user of the same tenant, offered as the `parfocal-room-v1` subprotocol. Then for every round it posts one `presence.joined` and one `thread.updated` event to `/rt-internal/publish` with the publish signature, and waits for both browsers to receive it.
4. Latency is the time from just before the publish request leaves Node to the moment the slower of the two browsers receives the frame. Both clocks are on the same machine, and the browsers poll for arrival every 5 ms.
5. The same script ran once against `wrangler dev` on `127.0.0.1` as a control.

## Results

Milliseconds, slower of the two browsers, 30 rounds per run and kind.

| Run | Kind | Median | p95 | Max |
|---|---|---|---|---|
| 1 | presence.joined | 53 | 121 | 184 |
| 1 | thread.updated | 53 | 101 | 112 |
| 2 | presence.joined | 63 | 108 | 199 |
| 2 | thread.updated | 57 | 141 | 192 |
| 3 | presence.joined | 59 | 126 | 551 |
| 3 | thread.updated | 59 | 99 | 107 |
| Local `wrangler dev`, 20 rounds | presence.joined | 1 | 2 | 14 |
| Local `wrangler dev`, 20 rounds | thread.updated | 1 | 2 | 2 |

Both browsers received every one of the 180 deployed events. The upgrade answered 101 in workerd, locally and deployed, which COLLAB-001 could not exercise with its fake state.

## Interpretation

- The median of 53 to 63 ms and a p95 of 99 to 141 ms are well under the 300 ms budget. One of 180 events took 551 ms, so the budget holds at p95 but not for every single event.
- The number covers the edge only. No non-production API exists, so the hop from FastAPI committing a change to its background task posting the event is not in it. That hop is one HTTPS call from Modal to Cloudflare and is expected to add tens of milliseconds, which is an assumption to measure once a staging API exists.
- "Presence" here is an event of kind `presence.joined` posted like any other. Rooms in ADR 0140 do not yet announce who is connected. COLLAB-007 (presence) builds that, and since it travels on the same room fan-out, the latency above applies.
- The transport choice stays as ADR 0003 and ADR 0140 decided it, so no new ADR. The candidates in the task (FastAPI WebSockets with Valkey, Centrifugo, Server-Sent Events, a managed service) were not built.

## Follow-ups

- `apps/edge/wrangler.jsonc` deploys `parfocal-edge-dev` with the `ROOMS` binding on a SQLite-backed Durable Object class, which Workers Free allows. `wrangler` runs through `npx` and is not yet a devDependency of `apps/edge`. TODO: add it when the lockfile is free.
- TODO: repeat with a staging API publishing from a background task, to measure commit to browser.
