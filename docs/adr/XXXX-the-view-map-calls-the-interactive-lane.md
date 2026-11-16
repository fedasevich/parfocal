# XXXX. The view map asks the interactive lane for one view tile at a time

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AITUM-009 (Map this view asks the server for its tiles). Builds on AITUM-004 (view-scoped map on demand), AITUM-008 (the tumor map runs as a job and the API serves it), [ADR 0354](0354-the-api-warms-the-embedder-with-the-modal-sdk.md) (the API warms the embedder with the Modal SDK) and [ADR 0355](0355-the-tumor-map-job-shares-the-detector-good-pool.md) (the tumor map job shares the detector-good T4 pool).

## Context

The "Map this view" panel asks a scorer for one view tile at a time, 16 by 16 cells of 256 px, and draws each tile as it comes back. A view tile covers 2 by 2 job tiles of the tumor map job, both grids anchored at the slide origin, so it is a 64 by 64 box of the job's 64 px grid halved twice. The API had no synchronous path to a GPU pool. A map of the view must not become a ready heatmap result set, because a ready heatmap set hides the panel.

## Options

1. A box job the panel polls. The API enqueues a tumor map job limited to a cell box, the detector-good pool scores it, and the panel polls the job and then reads the tile from storage. The job input, both worker steps and the storage layout would need a box variant that writes somewhere other than a result set. A box job waits for the job worker's claim cycle, for a pool that scales to zero and for any detection queued ahead of it.
2. A call on the interactive lane. `POST /api/slides/{slide_id}/view-map/{column}/{row}` (`scoreViewMapTile`) sends a `view-map` call through the API's Modal client to the interactive embedder pool with `Function.remote` and answers with the tile's cell bytes. Nothing is stored.

## Decision

Option 2. `view-map` is an interactive lane kind, so the embedder pool accepts it and the batch pools refuse it. `WarmGate.request` in `parfocal_common.warm_gate` makes the blocking call and marks the gate touched, so a slow device's warm is not sent again right after a view map has woken the pool. The API runs the call in a thread.

`parfocal_common.view_maps` holds the call and the reply, which is raw `uint8` cells in row order, width times height bytes, 256 for a whole tile and fewer at the slide's right and bottom edges. `parfocal_ml.view_map.answer_view_tile` opens the slide, boxes the job grid with `tumor_map.map_slide`, keeps `stored_values` and halves twice with `tumor_map.halve`, the same maximum the stored pyramid uses. A view tile therefore equals the matching part of a full map's second pyramid level. The pool entry has no `view-map` runner yet, as it has none for `embed`. AITUM-012 (the interactive pool answers view map calls) adds it with the real slide opener and model of AITUM-010 (the tumor map job reads stored slides and runs the tumor model in its pool).

The route needs `run-models` and a project the person controls, the same rights as starting a tumor map, because each tile spends GPU time. It answers 404 for a slide the person cannot read or whose AI is hidden from them, refuses a hidden tumor model, answers 404 `view-tile-outside` for a tile past the slide's edge, and answers 409 `model-offline` when the pool fails or sends no cells of the right size. Every scored tile writes a `view-map.scored` audit event.

The web uses the server scorer whenever the fake API is off and shows the panel only to a researcher who owns the project, the same rule as the run panel. With the fake API and dev tools on it keeps the fake scorer.

## Consequences

- The embedder pool has one T4 container. A view map and a segmentation embed for another person queue behind each other there. If that slows segmentation, the view map needs a pool of its own and an owner decision, because the 5 USD hourly cap that ADR 0355 (the tumor map job shares the detector-good pool) works within has no room.
- The embedder pool entry has no `view-map` runner yet. Until AITUM-012 (the interactive pool answers view map calls) adds it, every project owner on the real API sees the panel and each click ends in "This view could not be mapped".
- The route holds its tenant database connection and one thread while it waits for the pool, and the call has no timeout of its own. Many slow tiles at once could use up the API's connection pool.
- The fake API still shows the panel to reviewers, while the server refuses them. Who may map a view is open decision 129 (who may map a view of a slide on the server) in `docs/decisions.md`.
- A cold embedder start, up to about a minute, lands on the first tile. The panel shows "Mapping this view" until it ends.
- One view tile scores 4 job tiles. At the 0.34 s a tile measured on a laptop GPU that is about 1.4 s, above the 1 s interactive target. The T4 time is not measured (TODO).
- Each ask can send up to 64 tile calls, one after another. Nothing caps the GPU seconds of view maps per person yet (TODO if the bill shows it).
- No GPU time from view maps is reported to `gpu_usage`, which counts jobs only.
