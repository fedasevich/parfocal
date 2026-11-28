# Result: what storing tissue masks adds to the showcase seed

- Date: 2026-11-28
- Backlog: PROTO-211 (the PathoSAM + HoVer-NeXt run says honestly what it makes and how long it takes), against PROTO-139 (the production reseed finishes in under 15 minutes)
- Kind: benchmark
- Commit: the PROTO-211 fix on top of f12a3e3e
- Environment: Apple M4, local Postgres in the shared parfocal compose project, an in-memory object store that links each original from the local fixture cache instead of copying it, so no download time is in these numbers
- Data: the showcase seed with an owner email, the fixture cache of the format gallery and test_065 (no PHI)

## Question

How much time does the new tissue mask step (`parfocal_ingest.tissue_seed.store_seeded_masks`) add to a seed, the first time and on a reseed?

## Method

`apps/api/tests/test_showcase_tissue.py` runs `showcase.seed` and then the mask step three times, timing each with `time.monotonic`: on a fresh database, again with every mask in place, and after deleting every mask under `t/` to stand in for a reset, which keeps the files beside the originals. `mask_files_from` was also timed alone on five large fixtures, with peak memory from `getrusage`.

## Results

| Run | Slides | Outcome | Time |
| --- | --- | --- | --- |
| First seed | 117 | 114 stored, 3 with no original in the cache | 2.4 s |
| Second seed | 117 | 114 already present | under 0.5 s |
| After a reset | 117 | 78 copied from beside the original, 36 rendered again from `fixtures/` originals, 3 missing | 2.2 s |

| Fixture | File size | Mask time | Peak process memory |
| --- | --- | --- | --- |
| OS-1.bif | 3.9 GB | 0.73 s | 512 MB |
| Philips-3.tiff | 3.3 GB | 0.18 s | 518 MB |
| test_065.tif | 0.45 GB | 0.05 s | 529 MB |
| Leica-1.scn | 0.29 GB | 0.11 s | 540 MB |
| CMU-1.ndpi | 0.20 GB | 0.03 s | 548 MB |

## Interpretation

The masks are made from a coarse pyramid level, so computing them costs a few seconds over the whole seed. In production the seeded originals live under `fixture-slides/` and `samples/`, which a reset keeps, so the mask is kept beside each original. Only the first deployed seed after this change downloads the originals once, about 9 GB for the format gallery and test_065. That download was not measured. Every later reseed costs one head request a slide and one copy per original. The peak memory stays under the seed function's 1 GB on Modal. The step runs after the workspace transactions, so it adds no lock wait.
