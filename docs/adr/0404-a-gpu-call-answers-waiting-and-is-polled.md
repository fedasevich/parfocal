# 0404. An interactive GPU call answers "waiting" and the viewer polls it

- Date: 2026-11-19
- Status: Accepted
- Deciders: Claude
- Backlog: OPS-038 (a GPU call waiting for an EU GPU shows the wait, not an error)

## Context

Decision 159 (what a GPU job does when Modal has no GPU free in the EU) keeps every GPU pool pinned to Modal's `eu` region. On 2026-11-19 a view map call waited 244 s for an EU T4. The typer and the view map hold the HTTP request until the embedder pool answers, and Cloudflare ends any request at 100 s with a 524, so the viewer showed a failure for a call that would have succeeded. After the v0.22.0 smoke the embedder pool had four queued inputs and no runner while November's Modal spend was $2.37, so the cause is EU T4 capacity, not budget.

The typer (OPS-026) and the view map (OPS-036) both call the `embedder` function through `WarmGate.request`. The tumor map (OPS-037) is already a queued job with its own progress and does not hold a request, so it keeps its path.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. A database job row per call, like model runs and the jobs tray | Survives anything, shows in the tray | A migration and a worker for a call that usually answers in a second, and the tray is for long work the person leaves |
| 2. Hold the request longer behind a Cloudflare setting | No client change | The 100 s limit needs an Enterprise plan, and the wait can pass any fixed limit |
| 3. Spawn on Modal, hold up to 45 s, then answer 202 with a signed token naming the Modal call, and let the client post again with the token | No storage, any API container can resume the call, the fast path is one request as before | The client must loop, and a token in a URL must be scoped |
| A. Leave the embedder pool on T4 only | Cheapest card | A busy EU T4 market keeps the person waiting |
| B. Let the embedder pool take a T4 or an L4, both pinned to `eu` | Two EU markets instead of one, the data never leaves the EU | An L4 hour costs more |

## Decision

Option 3 with pool choice B.

- `WarmGate` gains `submit`, `outcome` and `cancel`. `ModalPools` implements them with `Function.spawn`, `FunctionCall.get(timeout=...)` and `FunctionCall.cancel`. A pool that only has `call`, such as every test stand in, is wrapped by `HeldCalls`, which answers at once.
- `parfocal_api.gpu_calls.GpuCalls.answer_or_wait` is the one helper a route uses. It holds at most `HOLD_SECONDS` (45 s) per request. If the pool has not answered, the route returns 202 with `GpuWaiting` (`state`, `call`, `waited_seconds`, `hold_seconds`) and `Cache-Control: no-store`.
- The token is signed with the tile token keys and names the Modal call, the kind of call, the tenant, the slide, a hash of the person and the start time. It lives 30 minutes. A token for another person, tenant, slide or kind answers 404 `gpu-call-not-found`.
- The client posts the same request again with `?call=<token>`. `DELETE /api/gpu-calls/{call}` cancels the Modal call for its owner and answers 204. A token it cannot open, or one of someone else, also answers 204 and cancels nothing, so a stale Cancel never shows an error and the route reveals nothing about other calls.
- Every answer logs `gpu call answered` with `gpu_kind`, `waited_seconds` and `slow_wait` (over 60 s), every 202 logs `gpu call waiting` and every cancel logs `gpu call cancelled`. The `view-map.scored` and `outlines.typed` audit entries carry `waited_seconds`, so the week's result can be counted from the database.
- The web app's `untilGpuAnswers` in `apps/web/src/gpu/gpu-wait.ts` runs the loop, publishes each wait to one store, and `GpuWaitNotice` in the slide stage shows "Waiting for a GPU" with the seconds and Cancel. Cancel aborts the fetch and calls the DELETE route. A cancelled view map rests instead of failing.
- The deployed smoke polls the token, and if the first call is still waiting or answers 502, 503, 504 or 524 it waits 3 minutes and makes one fresh call before it fails.
- The embedder pool asks Modal for `["T4", "L4"]` in `eu`, keeps `min_containers` 0 and one container, and gets a 300 s `startup_timeout`. Modal's `timeout` counts execution, not time in the queue, but a cold start counts against `timeout` unless `startup_timeout` is set, so the 60 s call timeout no longer cuts a cold container loading its weights.

Any later GPU route, such as AISEG-024 (Best one-click through a ViT-L embedding route on Modal), adopts the same two calls: `answer_or_wait` on the API and `untilGpuAnswers` in the viewer.

## Cost

At Modal's 1.15 times `eu` multiplier a T4 hour is about $0.68 and an L4 hour about $0.92. The embedder pool has one container, so the fallback costs at most $0.24 more an hour and only while an L4 is serving. The worst case of all pools at their caps rises from $4.76 to $4.97 an hour at base prices, still under the $5.00 cap in `gpu_pool.py`. The detector and typer batch pools keep a single card, because they run queued jobs that nobody watches and adding the L4 to them would pass that cap. The project's $30 a month Modal limit is unchanged.

## Consequences

- No request through Cloudflare waits more than about 45 s for a GPU.
- A token in the URL names only identifiers and a person hash, no PHI.
- Waits are counted in logs and audit entries. After a week a result file reports how often the EU wait passed 60 s (OPS-038's Done line).
- Cancelling a Modal call does not stop a container that is already starting, which still bills until its 300 s scale down.
