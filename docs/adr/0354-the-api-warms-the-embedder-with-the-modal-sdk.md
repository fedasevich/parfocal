# 0354. The API warms the embedder with the Modal SDK

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AIP-021 (pre-warm trigger from a slow device through the API). Follows [ADR 0150](0150-gpu-serving-on-t4-and-l4-class-cards.md) (GPU serving on T4 and L4 class cards) decision 4, which has the API pre-warm the interactive embedder when a slow device opens the segmentation tool.

## Context

AIP-007 (interactive priority gate) built the throttle that sends at most one `warm` call per 240 s to the `embedder` function of the Modal app `parfocal-gpu-pool`, which scales down after 300 idle seconds. The API runs as the `web` function of the Modal app `parfocal-api` and needs some way to reach that function. The API image installs `apps/api` and `parfocal-common` only, not `parfocal-ml` with its numpy and scipy stack.

## Options considered

1. The Modal SDK in the API. `modal.Function.from_name("parfocal-gpu-pool", "embedder").spawn(...)` runs inside the `web` container. Modal gives every container its client and credentials for its own workspace and environment, and `modal_app.py` already imports `modal` there. The call needs no token, secret or public endpoint.
2. A call through the ML app. The GPU pool app would expose a `fastapi_endpoint` or `asgi_app`, and the API would call it over HTTPS with a shared secret or proxy auth tokens. That adds a web endpoint that is always reachable, a secret to rotate and a CPU container in front of the GPU pool.
3. The worker queue. The API would write a `warm` job row that a worker claims and forwards. The job worker polls, so the warm would arrive seconds late and cost a claim cycle for a fire-and-forget hint.

## Decision

Option 1. The pure part of the gate, with `Device`, `Warm`, the `Pools` protocol, `WarmGate` and `ModalPools`, moved to `parfocal_common.warm_gate`. `parfocal_ml.priority_gate.InteractiveGate` extends it with the lane check. `ModalPools` imports `modal` lazily, so the API package needs no new dependency. `parfocal_deploy.modal_app.serve` puts one `WarmGate(ModalPools())` on `app.state.warm_gate`. Without it, as in local dev and tests, the API uses an idle gate whose pools do nothing. Tests inject a fake client the same way.

`POST /api/slides/{slide_id}/embeddings/warm` (`warmSlideEmbedder`) takes `{"device": "slow" | "fast"}`, needs `see-slides` and a slide the person can read, and always answers 204, so a caller cannot learn whether another workspace warmed the shared GPU. A Modal error is logged by type only, and the route still answers 204. The throttle still counts that attempt, so a missing GPU app is retried at most once per 240 s.

The web calls the route when the segmentation tool loads its services for a slide and the browser has no WebGPU adapter. That is the same check that makes the SAM engine fall back to WebAssembly, which is the slow path ADR 0003 (pilot platform architecture) means. A device with an adapter sends nothing. The warm goes out when the tool loads its real services, about 350 ms after the tool is switched on, and never from the fake services of the dev build.

## Consequences

- The throttle lives in each API container's memory. `web` allows 4 containers, so at worst 4 warm calls go out per 240 s. Each one only spawns a container that is already warm or starts one that scales down after 300 s.
- The API's Modal client is the container's own identity. If the API ever leaves Modal, it needs a Modal token or option 2.
- Nothing was deployed with this change. The call from a real `web` container to `parfocal-gpu-pool` in environment `main` is untested until the GPU pool app is deployed there. TODO: check one warm after the first deploy.
- `queue_minutes` adds other tenants' runs on the shared GPU through the `SECURITY DEFINER` function `parfocal_shared_queue_minutes`, which reads past row-level security only because its owner, the migration role, may. Locally that is the superuser `parfocal`, and on Neon the default role is a member of `neon_superuser`, as `knowledge/database.md` says. An owner without that right would see no other tenant and add 0, which leaks nothing.
- Once deployed, each slow device that opens the tool starts an embedder container for up to 300 s while the `embed` runner is still a stub.
- The `embed` runner in `parfocal_ml.modal_pool` still has no PathoSAM weights. Loading them is a later task.
