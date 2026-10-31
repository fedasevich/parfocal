# Test fixtures

How slide fixtures are fetched, cached and checked. The package is `packages/test-fixtures` and its [README](../../packages/test-fixtures/README.md) has the commands.

## Link slides from the POC instead of downloading them

The owner's disk is short on space. `PARFOCAL_FIXTURES_LOCAL` in `.env` names folders, separated by `:`, that hold slides already on disk. `pnpm fixtures` symlinks a file from there into the cache when its size and SHA-256 match the manifest, and downloads only when no good local copy exists. On the owner's machine it points at the POC's `public/data/formats`, which covers every OpenSlide file and `tumor_009.tif`. `test_001.tif` has no local copy, so the `camelyon` group downloads 1.1 GB. Do not run it unless the owner asks. Source: FOUND-016 log entry.

## The POC's JP2K-33003-1.svs is corrupt

The copy in `poc/public/data/formats` has the right size but differs from the published file from byte 37,969,472 onwards, about 1.2 million bytes in all. It probably came from a resumed download that appended to the wrong offset. The SHA-256 check refuses to link it, so a verified download sits in the cache instead. The POC's numbers for this slide may come from a damaged file. Source: FOUND-016 log entry.

## Where the checksums come from

The OpenSlide test data publishes `index.json` with a SHA-256, size and licence for every file. CAMELYON16 publishes only `checksums.md5`. The CAMELYON16 SHA-256 values in `fixtures.json` were computed after each file matched its published MD5.

## Synthetic OME-TIFFs change on every run

tifffile writes a random UUID into the OME-XML, so regenerating the synthetic slides changes their checksums even when the pixels are the same. `make_synthetic.py` rewrites the `synthetic` checksums in `fixtures.json`, and the manifest test catches a slide committed without them.

## Patient names in tests come from one registry

Every patient name a test or fixture uses must be in `SYNTHETIC_PATIENT_NAMES` in `apps/api/tests/synthetic_people.py`, which marks it as made up. `test_fixture_hygiene.py` scans the Python test folders and their JSON, CSV and GeoJSON fixtures for names given to `PatientIdentity`, in a `"patient": {"name": ...}` body or in the name column of a case import CSV, and fails on any name that is not registered. A new test patient is added to the registry in the same change, which is the moment to check the name is invented. The scanner cannot tell a real person from an invented one, so the registry is the review.

## tifffile stores YCbCr input as it is given

`make_synthetic.py` writes RGB arrays with `photometric="rgb"` and JPEG compression, and tifffile tags the result as YCbCr (photometric 6) with properly converted samples, which is why `synthetic-jpeg.tiff` is a YCbCr fixture. Passing `photometric="ycbcr"` instead stores the array as if it already were Y, Cb and Cr, so RGB input comes back with the wrong colours. `synthetic-big-endian.tiff` and `synthetic-sparse.tiff` were added for the browser reader workarounds, and the manifest test now accepts both byte orders and BigTIFF. Source: STACK-016.

## Golden images come from a synthetic tile and SwiftShader

The golden suite draws `syntheticHeTile()`, an H&E-like tile generated in code with red, green and blue ramps and a fine checkerboard, so no image is downloaded and no PHI is involved. The ramps make a swapped channel obvious in the diff. A golden is only written after the frame passes the empty-frame check, and `pnpm golden:update` is the only way to change one ([packages/golden-images](../../packages/golden-images/README.md)). Per-format goldens for real slides wait for the Viv route.

## Perf pages need an inline favicon

Chrome requests `/favicon.ico` after loading a page, and through the latency proxy that request lands in the request and byte counters at an unpredictable moment. The perf test page declares `<link rel="icon" href="data:,">` so the counters only see the requests a test makes.

## The viewer group feeds the browser CI job

`viewer` holds only the slides the browser golden images open, today `CMU-1.svs` (170 MB), which also stays in `formats`. The `browser` job caches it under `fixtures-viewer-<hash of fixtures.json>` and runs `pnpm test:browser` with `PARFOCAL_REQUIRE_FIXTURES=viewer`, so a missing slide fails instead of skipping. A manifest test keeps the group under 256 MB. Add a slide to the group only when CI must run its goldens. Source: VIEW-002.

## The small group feeds the db CI job

The `db` job caches `small` under `fixtures-small-<hash of fixtures.json>` and runs `uv run pytest -m db` with `PARFOCAL_REQUIRE_FIXTURES=small`, because `test_slide_ingest.py` uploads `CMU-1-Small-Region.svs` (1.9 MB, a real Aperio slide with a label and a macro) through the upload API and ingests it end to end. The other ingest database tests use the committed `synthetic-jpeg.tiff`, so they run on any machine. Source: INGEST-017 (publish step and slide status).
