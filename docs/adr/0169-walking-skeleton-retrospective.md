# 0169. Walking skeleton retrospective

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: SKEL-010 (skeleton retrospective)

## Context

The walking skeleton (milestone M1) is meant to prove the stack, the deployment and the test pipeline together on staging. On 2026-11-03 four of its tasks are done: SKEL-003 (tables), SKEL-005 (validate and index the slide), SKEL-006 (open the slide in Viv) and SKEL-008 (stub decision and submit). SKEL-007 (draw and save one polygon) is ready. SKEL-001 (staging), SKEL-002 (log in through the IdP), SKEL-004 (upload into a project) and SKEL-009 (CI deploys to staging) wait on OPS-001, OPS-002, OPS-005, IAM-001 and INGEST-001. Breadth epics were built ahead of the skeleton, so everything below was proven on the local stack, in hosted CI or in a spike, and nothing on staging.

## What the skeleton revealed

Latency, from [performance budgets](../results/2026-11-02-performance-budgets.md), [latency proxy](../results/2026-10-23-latency-proxy.md), [tile gateway latency](../results/2026-11-02-tile-gateway-latency.md) and [sidecar tile index](../results/2026-11-02-sidecar-tile-index.md):

| Measure | Number | Reading |
|---|---|---|
| `CMU-1.svs` fitted view, 0, 100 and 200 ms RTT | 859, 1,871 and 3,174 ms | About 12 round trips. Above 50 ms RTT the network dominates |
| Sharp after a jump to 10x, same RTTs | 283, 1,382 and 2,698 ms | 13 requests of exactly 1 MiB each |
| Requests and bytes per open | 8 and 7,683,267, the same at every RTT | Deterministic enough for a 20% CI limit |
| 11-level BigTIFF open at 100 ms RTT | 1.39 s by walking the chain, 0.38 s with the sidecar | Cutting round trips pays more than CPU work |
| Warm tile fetch p95 through the Worker | 157 to 159 ms without the cache, 65.5 and 73.3 ms with it | The TILES-002 budget is 60 ms, so the cache layer is needed |
| First request to a fresh Worker isolate | 344.9 ms | One sample |

The latency proxy speaks HTTP/1.1, so 12 parallel requests take two RTTs where production HTTP/2 takes one. Local budgets are pessimistic for that reason. The tile numbers came from a home network to the AMS colo, not from the same region.

Memory, from [memory and teardown on SwiftShader](../results/2026-10-23-memory-teardown-swiftshader.md): 20 slide switches keep exactly one Deck and the heap 3.9% to 4.0% over the baseline taken after a warm-up cycle. Without `canvasContext.destroy()` all 26 decks stay alive and the heap ends 137.5% over baseline, so the `disposeDeck` wrapper of [ADR 0098](0098-viv-and-deck-gl-versions.md) stays. Measured from the first open the heap grows 12.7%, mostly V8 compiled code, which is why [ADR 0103](0103-memory-settings-and-test-baseline.md) takes the baseline after warm-up.

Gaps:

1. Nothing is deployed. The M1 gate says "all on staging", and no skeleton step has run there. Staging also lacks the upload CORS and unfinished-upload rules (decision 6a).
2. No number comes from staging or from the field. Staging latency, warm tile p95 from the same region over HTTP/2 and the hosted-runner budget numbers are TODO. The CI time limits rest on the assumption that hosted runners are at most three times slower on the CPU part.
3. The upload end to end ran only against a Companion stand-in over MinIO (INGEST-002), not the real API.
4. The viewer still takes the slide format from the original's file extension, although INGEST-004 already identifies it from the bytes.
5. Each run of the SKEL-008 end-to-end test leaves one workspace and one sample project in the local database.
6. Memory on `CMU-1.svs` and GPU texture memory are not measured. SwiftShader reports no GPU memory.

## Decision

- The skeleton is finished in dependency order and not widened further: SKEL-007 now, then OPS-001 and OPS-002 for SKEL-001, IAM-001 for SKEL-002, INGEST-001 for SKEL-004 and OPS-005 for SKEL-009.
- The Cache API layer of the tile gateway is on before anything is measured on staging.
- New task SKEL-011 measures the skeleton on staging and on hosted runners and tightens the budgets from those numbers. New task SKEL-012 makes the viewer take the format from ingest. TEST-004 cleans up what each end-to-end run creates, and TEST-007 adds `CMU-1.svs`.
- Round trips are the latency budget to defend. A change that adds a sequential request to opening or jumping needs a measured reason.

## Consequences

M1 stays open until the infrastructure and IdP tasks land, which is the costly part the skeleton was meant to surface early and has not yet. The numbers in this ADR are local and are replaced by SKEL-011's result file when it runs.

## Alternatives

| Option | Why not |
|---|---|
| Close M1 on the local stack | The milestone exists to prove deployment, and none is proven |
| Wait for staging before writing the retrospective | The local numbers already change the plan, for example the tile cache |
