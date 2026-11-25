# Result: uploaded MIRAX and DICOM zips converted in the ingest workflow

- Date: 2026-11-25
- Backlog: INGEST-033 (uploaded MIRAX and DICOM zips open in the viewer), following [ADR 0408](../adr/0408-mirax-and-dicom-slides-are-served-as-a-lossless-pyramid-tiff-made-at-ingest.md) (MIRAX and DICOM slides are served as a lossless pyramid TIFF made at ingest)
- Kind: benchmark
- Commit: the INGEST-033 commit on top of 0da5e054
- Environment: the owner's MacBook (Apple M4, 24 GB), macOS 15, Python 3.14 through `uv`, Docker Desktop for the local stack, other agents running. Times are one run each
- Data: the public OpenSlide test fixtures `CMU-1-Saved-1_16.zip` and `CMU-1-JP2K-33005-v2.zip` from the fixture cache. No PHI

## Question

Does the converter fit the parse limits of the upload workflow (3072 MiB watched resident memory, 1800 s per step, 1 GiB returned per parse call), and do uploaded zips open in the viewer?

## Method

1. The converter now streams 256 px tiles to tifffile from bands of 1024 rows instead of holding each level in a memory-mapped file. `/usr/bin/time -l uv run --package parfocal-ingest python -m parfocal_ingest.pyramid_tiff CMU-1-JP2K-33005-v2.zip original.tiff`, once with 2048-row bands and once with 1024-row bands.
2. `uv run pytest apps/api/tests/test_zip_ingest.py -m db` uploads both zips through the upload API and runs the ingest worker with the default parse limits and the local isolated parser.
3. `apps/web/e2e/uploaded-zip-live.spec.ts` on a local real stack (`infra/local/stack-up.sh` under the compose project `p033`, ingest worker in its Linux container) uploads the MIRAX folder and the DICOM zip through the upload window and opens each slide.

## Results

| Run | Time | Peak resident memory | Output |
|---|---|---|---|
| DICOM conversion, earlier converter with memory-mapped levels (2026-11-20 result) | 108 s | 3.6 GB | 1,075,404,540 bytes |
| DICOM conversion, 2048-row bands | 82 s | 2.13 GB | 1,075,404,540 bytes |
| DICOM conversion, 1024-row bands | 79 s | 1.80 GB | 1,075,404,540 bytes |
| MIRAX upload through the workflow (pytest) | 5.2 s | not measured | 18,725,365 bytes |
| DICOM upload through the workflow (pytest) | 119 s | under the 3072 MiB watch | 1,075,404,540 bytes |
| MIRAX folder in the upload window, real stack | 21 s | not measured | 18,725,365 bytes |
| DICOM zip in the upload window, real stack | 1.8 min | under the 3072 MiB watch | 1,075,404,540 bytes |

- Every MIRAX level still equals OpenSlide's pixels in `test_pyramid_tiff.py`.
- Both published slides keep the format `mirax` or `dicom` with the variant `pyramid-tiff`, their original is `original.tiff` and starts with the BigTIFF signature, the tile index names `generic-tiff`, and the label and macro come from the zip.
- A MIRAX zip whose `Data0000.dat` is zeroed passes identification, the integrity scan and the level table, and is refused as `unconvertible`.
- The converted DICOM is 1,075,404,540 bytes, above the 1 GiB a parse call could return before, so the conversion call alone now returns up to 16 GiB.

## Interpretation

The streaming converter keeps the DICOM fixture at 59 percent of the parse memory limit on macOS. The remaining memory is the readers and their caches, not the level, so it should grow slowly with slide size. That is an assumption, because only one DICOM slide was measured. Memory and time in the Modal parse sandbox (3072 MiB, 1800 s per step) should fit this slide, so its settings were left alone. Whether `copy_to_local` and `copy_from_local` stream a 1 GB file without buffering it in the ingest function (2048 to 4096 MiB) was not measured, and the sandbox's CPU share may make the conversion slower than on the Mac.

## Follow-ups

- TODO for the lead: after merge and deploy, upload `CMU-1-JP2K-33005-v2.zip` in the deployed app and open it. The sandbox CPU share and the copy of a 1 GB output out of the sandbox were not measured in the cloud.
- A refusal in index or derive now discards the converted TIFF. Zips whose TIFF would pass 16 GiB, roughly 1.9 GB of DICOM at this ratio, are refused as too large.
- The DICOM cases of both tests skip in CI, because the db and e2e jobs fetch only the `small` fixtures.
- The upload window takes a `.zip` as a slide now, but it still uploads a folder of `.dcm` files one by one instead of zipping it like a MIRAX folder.
