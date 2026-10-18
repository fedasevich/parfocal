# Result: TNBC and NuInsSeg load from their verified Zenodo archives

- Date: 2026-10-18
- Backlog: MLEVAL-001 (dataset registry and loaders)
- Kind: baseline
- Commit: c4fe75e plus the uncommitted `parfocal_ml.datasets` of MLEVAL-001
- Environment: MacBook (Apple silicon, arm64), macOS 15.8.1, Python 3.14 through uv, Pillow, numpy and scipy
- Data: TNBC v1.1 (`TNBC_NucleiSegmentation.zip`, Zenodo record 2579118, downloaded on 2026-10-18) and NuInsSeg v1.0 (`NuInsSeg.zip`, Zenodo record 10518968, an existing local copy). Neither is committed

## Question

Do the archives match the checksums Zenodo publishes, and do the loaders give the images and nuclei the POC's prepared fixtures have (`poc/server/fixtures/tnbc` and `nuinsseg`, built by `prep_heldout.py`)?

## Method

Read each record's file list from `https://zenodo.org/api/records/<id>` and compare size and MD5 with the archive in the cache (`~/.cache/parfocal/datasets`). Load every sample with `parfocal_ml.datasets.samples(name)`, which reads the archive without extracting it, and count images, groups and nuclei. Compare the nuclei per image with the `total` of each image in the POC's `index.json`. `workers/ml/tests/test_datasets.py` repeats the counts when the archives are cached.

## Results

| Dataset | Zenodo size and MD5 | Images | Groups | Nuclei | POC nuclei | Images that differ from the POC |
|---|---|---|---|---|---|---|
| TNBC v1.1 | 25,232,361 bytes, `1605712a752b201b57eacc8f866adb4f`, matched | 50 | 11 slides | 4,053 | 4,056 | 2: `03_5` (69 against 71) and `07_3` (297 against 298) |
| NuInsSeg v1.0 | 1,627,427,342 bytes, `08f9a33e23e983d82ee93aa58e69d095`, matched | 665 | 31 organs | 30,698 | 30,698 | 0 |

The POC's local TNBC archive (`~/.cache/heldout/tnbc.zip`, 25,279,869 bytes, MD5 `fe14b0936673ab70c38475f89db78553`) matches neither TNBC v1.1 nor v1.0 (`TNBC_DataSet.zip`, 25,232,882 bytes, MD5 `74d2106333fc6f04fd4fa5054ca2d3ef`).

## Interpretation

- NuInsSeg loads exactly as the POC prepared it, vague-area masks included.
- TNBC v1.1 has three nuclei fewer than the POC's copy, in two images. Its changelog says it fixed pixels wrongly labelled as nuclei, which fits, but the POC's archive could not be matched to a published version, so this is an assumption. Numbers on TNBC from here on use v1.1 and are not exactly comparable with the POC's TNBC numbers.
- CryoNuSeg, MoNuSeg, PanNuke and Lizard have no public download with a published checksum, so the registry records their licence and source and refuses to fetch them. CAMELYON16 slides come through `packages/test-fixtures`.

## Follow-ups

- TODO: loaders for PanNuke (Warwick publishes no checksum, so its first download would be recorded as the reference), CryoNuSeg (needs a Kaggle sign-in) and Lizard (needs CoNIC registration).
- TODO: rescore the TNBC methods of the [scorer reproduction](2026-10-18-geometric-scorer-reproduction.md) on v1.1 once MLEVAL-003 reruns the models.
