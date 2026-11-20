# 0407. GPU pools run in any region until real patient data arrives

- Date: 2026-11-20
- Status: Accepted
- Deciders: Owner, Claude
- Backlog: OPS-038 (a GPU call waiting for an EU GPU shows the wait, not an error)
- Changes: decision 159 (what a GPU job does when Modal has no GPU free in the EU), which kept the EU pin

## Context

Every GPU pool was pinned to Modal's EU region next to the database. On 2026-11-20 the first Best one-click call on the deployed app waited 389 s for an L4 in the EU before it ran (`docs/results/2026-11-20-gpu-wait-on-a-cold-eu-pool.md`). The deployed app is a development environment by ADR 0390 (app.parfocal.eu is a development environment) and holds only public test slides. The owner asked on 2026-11-20 to let GPUs run anywhere in the world if that makes sense, so they start earlier.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Keep the EU pin | Image patches never leave the EU | Waits of minutes for a cold GPU, which makes one-click tools feel broken |
| 2. Drop the pin for good | Fastest starts, and Modal charges less without a region pin | Real patient patches would leave the EU once production holds them |
| 3. One setting, unpinned now and pinned again before real data | Fast starts today, and the pin returns with one variable | Someone has to set it before the first real user |

## Decision

Option 3. `PARFOCAL_GPU_REGION` decides the region of every GPU pool at deploy time. Empty means any region and is the default now. A value such as `eu` pins every pool again and must pass the same EU or US region check as before. The rule that a GPU fallback list needs a region pin is gone, since a fallback card helps in any region.

## Consequences

- Cold GPU calls on the dev app should start sooner. The wait log lines now carry the GPU kind and seconds (OPS-038), so the effect can be measured.
- Image patches sent for embedding or detection may be processed outside the EU while the app holds only public test slides.
- OPS-014 (production for the first real user) must set `PARFOCAL_GPU_REGION=eu` in the deploy environment, or record a new decision, before any real patient slide is uploaded.
