# XXXX. GPU pools take any card big enough for their model, cheapest first, in any region

- Date: 2026-11-25
- Status: Accepted
- Deciders: Owner, Claude
- Backlog: OPS-042 (GPU pools take any GPU big enough in any region)
- Amends: ADR 0404 (an interactive GPU call answers waiting and the viewer polls it), ADR 0150 (GPU serving on T4 and L4 class cards) rule 2, ADR 0241 (GPU worker pool limits) rule 6, and decision 159 (what a GPU job does when Modal has no GPU free in the EU)

## Context

ADR 0404 (an interactive GPU call answers waiting) kept every GPU pool in Modal's `eu` region and gave only the embedder a second card, the L4. ADR 0407 (GPU pools run in any region until real patient data arrives) then made the region a deploy setting, `PARFOCAL_GPU_REGION`, empty by default. The batch pools still asked for one card each. On 2026-11-23 a 2 tile whole slide run waited 18 minutes for a free L4, and on 2026-11-24 the deployed check of PROTO-168 (a queued whole slide run starts within its promised time) waited 29.6 minutes for an L4 against a 19 minute promise (`docs/results/2026-11-24-deployed-check-proto-073-145-168.md`).

The owner answered decision 181 (whether whole slide runs fall back to a bigger GPU when no L4 is free) on 2026-11-25 with "pick any region any available big enough gpu so it is just fast", and confirmed that GPU work may leave the EU while the app holds no real patient data. ADR 0003 (pilot platform architecture) already allows no region pin until its "first tenant with real PHI" trigger fires.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Keep one card per batch pool, unpinned | Cheapest card every time | A busy L4 market still keeps a run waiting, as on 2026-11-24 |
| 2. Each pool lists every Modal card big enough for its model, cheapest first, and the $5 cap counts one pool | Modal takes the first free card of the list, so a run starts on whatever is free | A run may land on a card that costs up to five times the L4, and all pools at once can cost more than $5 an hour |
| 3. As option 2, but keep the $5 cap on all pools together | All pools at once stay at $5 an hour | Seven containers leave room for nothing dearer than the L4, so the lists could not grow |

## Decision

Option 2.

- `Gpu` in `workers/ml/src/parfocal_ml/gpu_pool.py` names the Modal cards T4, L4, A10, L40S, A100-40GB, A100-80GB and H100, with their memory and base price from Modal's pricing page on 2026-11-25 ($0.59, $0.80, $1.10, $1.95, $2.10, $2.50 and $3.95 an hour). The H200 ($4.54) is left out because Modal may already serve an `H100` request on an H200 at the H100 price. The RTX PRO 6000 ($3.03) and the Blackwell cards are left out for now, so the list holds only the datacenter cards the pools have been priced against. Adding one is one line in `Gpu` and its two tables, and the tests recompute every list.
- Each pool asks Modal for a list, cheapest first, and Modal tries the cards in that order. The list holds every card with enough memory for the pool's model budget whose price times the pool's container cap stays under `MAX_HOURLY_SPEND_USD` ($5). `cards_big_enough` computes that list, and the tests check that each pool's list equals it.

| Pool | Model budget | Containers | Cards | Worst case an hour |
| --- | --- | --- | --- | --- |
| detector-best | 20 GiB | 2 | L4, A10, L40S, A100-40GB | $4.20 |
| detector-good | 12 GiB | 2 | T4, L4, A10, L40S, A100-40GB | $4.20 |
| typer-best | 20 GiB | 1 | L4, A10, L40S, A100-40GB, A100-80GB, H100 | $3.95 |
| typer-good | 12 GiB | 1 | T4, L4, A10, L40S, A100-40GB, A100-80GB, H100 | $3.95 |
| embedder | 4 GiB | 1 | T4, L4, A10, L40S, A100-40GB, A100-80GB, H100 | $3.95 |
| lab-model | CPU | 1 | none | $0 |

- `validate_pools` refuses a list that is not cheapest first, names a card twice, holds a card too small for the model, or takes its pool to $5 an hour at its container cap. The check on all pools together is gone.
- No pool is pinned. `PARFOCAL_GPU_REGION` stays as the one switch that pins every pool again, as ADR 0407 (GPU pools run in any region until real patient data arrives) set it.
- A container reads its card from `nvidia-smi` once, and the tumor map and nuclei runners record that card in `gpu_usage` instead of the pool's first choice. If `nvidia-smi` fails, the first choice is recorded as before. Probe and warm replies carry the card too, beside the region and cloud Modal reports.
- Every run prints one JSON line `gpu pool run` to the Modal log with the family, kind, card, container, region and cloud, so a deployed run can be placed without a probe.

## Cost

A run only reaches a dearer card when every cheaper one on the list is busy, and a faster card finishes sooner, so a typical run still costs cents. The worst case of all six pools on their dearest card at once is $20.25 an hour at base prices, against $4.97 before. That worst case is bounded by the $30 a month Modal limit, which stays as it is, and by every pool scaling to zero. Unpinned pools also stop paying Modal's 1.15 times `eu` multiplier.

## Consequences

- A queued whole slide run starts on whatever card is free in any region, so the promised wait of PROTO-168 (a queued whole slide run starts within its promised time) no longer depends on the L4 market of one region.
- Image patches are processed wherever Modal finds a card, which ADR 0003 (pilot platform architecture) and ADR 0407 (GPU pools run in any region until real patient data arrives) allow while the app holds only public slides and fake patients.
- When the "first tenant with real PHI" trigger of ADR 0003 (pilot platform architecture) fires, the pools are deployed with `PARFOCAL_GPU_REGION=eu`, and each list is trimmed to the cards the EU regions hold. That step is now in the trigger table of ADR 0003 (pilot platform architecture).
- The rule of ADR 0150 (GPU serving on T4 and L4 class cards) that A100 and H100 class cards are out of scope now covers only what a model is built for. Every model must still fit 16 GB, or 24 GB on the L4, and the larger cards are fallbacks that make a run start, never a requirement.
- Modal checks the card names only at deploy, so `A10`, `L40S`, `A100-40GB`, `A100-80GB` and `H100` are first accepted or refused by the next deploy of `parfocal-gpu-pool`.
- `gpu_usage.gpu` can now hold any card name, and an unknown card is recorded by its `nvidia-smi` name.
