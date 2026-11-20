# Result: size of a frozen dataset version

- Date: 2026-11-21
- Backlog: PROTO-115 (a dataset page with filters and stored versions)
- Kind: measurement
- Commit: the PROTO-115 commit that adds this file
- Environment: owner's Mac, local Postgres and MinIO of `docker compose`, Python 3.14
- Data: the showcase seed's "Annotation example" task on Philips-3.tiff, with the AI objects and hand work the seed writes, no PHI

## Question

How many bytes one frozen dataset version adds to R2, for ADR 0411 (a dataset version is one write once zip in the tenant prefix).

## Method

`uv run pytest -q -m "" tests/test_dataset_versions_seeded.py -s` in `apps/api`. The test seeds the showcase into a fresh database, marks the annotate task's slide signed off, builds the dataset with `dataset()` and the seed's in-memory result chunks, and zips it with `frozen_zip()` exactly as a freeze stores it. It prints one line, `dataset-version-size`, for the default filters (checked objects only, decision 170) and for "include unchecked". It was run twice.

## Results

| Filters | Slides | Objects | Of them unchecked AI | GeoJSON bytes | Stored zip bytes, run 1 and run 2 |
| --- | --- | --- | --- | --- | --- |
| Default, checked only | 1 | 17 | 0 | 9,344 | 2,861 and 2,857 |
| Include unchecked | 1 | 4,405 | 4,388 | 3,058,460 | 400,257 and 400,263 |

The zip sizes differ by a few bytes between runs because each zip entry and the manifest carry the time they were made.

## Interpretation

- A version costs about 168 bytes per checked object (2,861 over 17) and about 91 bytes per included unchecked AI object ((400,257 minus 2,861) over 4,388) after compression. These come from one slide. That a bigger task grows in proportion to its objects is an assumption, not measured.
- At R2's $0.015 per GB a month from `knowledge/platform.md`, the larger version costs about $0.000006 a month. Each freeze is one write, inside R2's free million writes a month.

## Follow-ups

- ADR 0411 records the storage.
- TODO measure again on a task with many signed off slides when one exists in the dev app.
