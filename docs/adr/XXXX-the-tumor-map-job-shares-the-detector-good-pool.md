# XXXX. The tumor map job shares the detector-good T4 pool and stops at 4,000 tiles

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: AITUM-008 (the tumor map runs as a job and the API serves it). Builds on AITUM-001 (tumor map job), ADR 0123 (model runs are engine jobs per slide) and ADR 0351 (the v1 tumor model stays the MONAI CAMELYON ResNet18).

## Context

The tumor map needs a job kind, a GPU pool and a cost cap. `parfocal_ml.gpu_pool` refuses any pool set whose containers at their caps cost more than 5 USD an hour. The five pools today reach 4.76 USD, and the cheapest card, a T4, costs 0.59 USD, so a sixth pool does not fit. Raising the cap is a spend change only the owner makes. No per-job cost cap existed anywhere.

## Options

1. A sixth pool for the tumor map, paid for by raising the hourly cap.
2. A sixth pool, paid for by taking a container from another pool.
3. The tumor map is a job lane kind that the existing detector-good T4 pool accepts, beside detection.

## Decision

Option 3. `Kind.TUMOR_MAP` is a job lane kind, so every batch pool accepts it and the interactive embedder pool refuses it, and `parfocal_ml.tumor_map_job.POOL_FAMILY` names detector-good, a T4 that scales to zero. The ResNet18 needs far less than the pool's 12 GiB budget. The worst-case hourly spend stays 4.76 USD.

The per-job cost cap is a tile cap. A job plans its tiles from the tissue mask and fails with `tumor-map-too-large` before scoring one when there are more than `MAX_TILES`, 4,000. A typical CAMELYON slide has about 1,160 tissue tiles, and at the POC's 0.34 s a tile, 4,000 tiles are about 23 minutes, or about 0.22 USD on a T4. Each job reports its seconds to `gpu_usage`.

The job adds no table. Its input holds the slide and the result set it fills, and the result set row points back at the job, as a model run's does. Step `map-scored` stores each tile's bytes under `t/{tenant}/s/{slide}/maps/{job}/` and marks it as a unit, so a restarted job scores only the missing tiles. Step `map-stored` assembles the grid, writes the heatmap and its pyramid under the result set's prefix, where `getHeatmap` reads, and marks the set ready.

## Consequences

- A tumor map waits behind detections in the same pool. If that delays reviewers, a pool of its own needs option 1 or 2 and an owner decision.
- A slide over 4,000 tissue tiles gets no map until the cap moves, which is one constant.
- The tumor map does not show in "My jobs", whose kinds come from uploads and model runs.
