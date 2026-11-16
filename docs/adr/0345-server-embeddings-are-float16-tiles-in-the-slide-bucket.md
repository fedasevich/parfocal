# 0345. Server embeddings are float16 tiles on a fixed grid in the slide bucket, and smart select snaps to a cached tile

- Date: 2026-11-16
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: AISEG-008 (server embedding service). Follows [ADR 0150](0150-gpu-serving-on-t4-and-l4-class-cards.md) (GPU serving on T4 and L4 class cards), decisions 4 and 5

## Context

The browser encodes every smart select patch itself with the quantised PathoSAM ViT-B encoder, which is slow on weak devices. AISEG-008 lets the server encode with the full precision encoder, cache the result over the tissue mask and send it, so the browser runs only the decoder. A 256 x 64 x 64 embedding in float16 is 2,097,152 bytes, which is over the 2 MB reply limit of ADR 0150 decision 5. Smart select centres its patch on the click, so a cache keyed by the exact patch would never hit.

## Options considered

1. A Postgres table of cached tiles with the bytes in the slide bucket. Needs a migration and a row per tile for what a listing of objects already says.
2. Objects in the slide bucket under `embeddings/`, one per grid tile, plus one `manifest.json` that names the encoder, level, tile size and a bitset of cached tiles (chosen).
3. The GPU function returns the embedding in its reply. Breaks the 2 MB limit and caches nothing.

## Decision

Option 2.

| Part | Where |
|---|---|
| Contract | `parfocal_common.embedding_cache`: tiles of 128 µm at the level resolution, the last row and column clamped inside the level, little-endian float16 in `[1, 256, 64, 64]`, keys `t/{tenant}/s/{slide}/embeddings/{column}_{row}.f16` and `manifest.json` written last |
| Encoding | `parfocal_ml.embedding_service.build_cache` encodes only tiles over the tissue mask through an `Encoder` protocol. The Modal entry for the `embedder` pool stays a stub until a task runs it with real weights |
| API | `GET /api/slides/{id}/embeddings` serves the manifest and `GET /api/slides/{id}/embeddings/{column}/{row}` the bytes, both behind `see slides` and the slide read check |
| Browser | `withServerEmbeddings` adopts a server tile through the new `adopt` call of the inference engine and falls back to local encoding on any miss or error. `withServerTiles` moves a click inside a cached tile to that tile's centre, so the patch is exactly the tile |
| Pairing | The browser adopts an embedding only when the manifest names an encoder its decoder pairs with, today `pathosam-vit-b-histopathology-fp32` |

## Consequences

- No migration. Deleting a slide's prefix deletes its embeddings.
- One manifest request per slide tells the browser every hit, so a miss costs no request.
- A click near a cached tile's edge is decoded near the patch edge, where the centred patch would have put it in the middle. The window decoder's edge fallback still applies.
- A larger encoder such as ViT-L needs its own decoder graph in the browser before its tag can be accepted. TODO: decided in `docs/decisions.md`.
- The region pass encodes tiles under its own ids, so it still encodes locally.
