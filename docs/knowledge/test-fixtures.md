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

`viewer` holds only the slides the browser golden images open, `CMU-1.svs` (178 MB), `CMU-1-JP2K-33005.svs` (133 MB) and `CMU-1.tiff` (204 MB), 514 MB in all, and each also stays in `formats`. The `browser` job caches them under `fixtures-browser-<cache key of small and viewer>`, prints `df -h "$HOME"` before and after the fetch and runs `pnpm test:browser` with `PARFOCAL_REQUIRE_FIXTURES=small,viewer`, so a missing slide fails instead of skipping. The golden specs call `skipUnlessCached` from `render/viv-harness.ts`, which skips a missing slide only when none of its groups is required. `JP2K-33003-1.svs` stays out of the group, so its golden skips in CI. A manifest test keeps the group under 512 MB. Add a slide to the group only when CI must run its goldens. Source: VIEW-002 and VIEW-054 (JPEG 2000 slide in the viewer fixture group).

## The small group feeds the db CI job

The `db` job caches `small` under `fixtures-small-<cache key of small>` and runs `uv run pytest -m db` with `PARFOCAL_REQUIRE_FIXTURES=small`, because `test_slide_ingest.py` uploads `CMU-1-Small-Region.svs` (1.9 MB, a real Aperio slide with a label and a macro) through the upload API and ingests it end to end. The other ingest database tests use the committed `synthetic-jpeg.tiff`, so they run on any machine. Source: INGEST-017 (publish step and slide status).

## Reader tests load slides through the package and CI caches them by checksum

Every format reader test finds a remote slide through `@parfocal/test-fixtures` (`cachedFixture`, `skipUnlessCached` or `fixturePath` in TypeScript) or `fixture_support.fixture_path` in Python, never a path of its own. A missing slide skips the test with the `pnpm fixtures` command to run, unless one of its groups is listed in `PARFOCAL_REQUIRE_FIXTURES`, and then the test fails. Turborepo hashes that variable into the `test` task, so a run that requires slides never replays a cached run that skipped them.

`pnpm fixtures --key GROUPS` prints the SHA-256 of the sorted file names and checksums of those groups, and every CI fixture cache uses it, so a cache is rebuilt only when one of its own slides changes and synthetic regenerations touch none. The jobs are `test`, `db` and `e2e` on `small`, `formats` on `small formats` (ingest pytest, the viewer-engine suite and the web patch reader test), `camelyon` on `small camelyon` (ingest pytest and the CAMELYON16 workaround test) and `browser` on `small viewer`. CAMELYON16 has a job of its own because the cache save writes a second copy of what it caches, and its 3.6 GB in the manifest next to the 2.3 GB of `formats` would crowd one runner disk. The job prints `df -h` before and after the fetch to show the headroom. On 2026-11-08 `gh cache list` showed `fixtures-formats` at 1.95 GiB, `fixtures-browser` at 136 MiB before VIEW-054 grew it by about 337 MB, the uv cache at 2.79 GiB and the pnpm store at 269 MiB against the 10 GB repository limit. The saved size of `fixtures-camelyon` is a TODO until its first run. The `browser` specs fail rather than skip when a slide of a required group is missing. The `big` (13 GB) and `huge` (6.9 GB) groups are never fetched in CI, so their tests, such as `Leica-3.scn` and `OS-1.bif`, run only on a machine that has them. Source: TEST-012.

## Every remote fixture also sits in R2

Since 2026-11-02 the 28 remote fixtures of `fixtures.json` (26.1 GB: small, formats, viewer, big, huge and camelyon) are uploaded once under `fixtures/<file>` in `parfocal-dev`, each checked against its SHA-256 before upload and its size after. The owner chose `parfocal-dev` over a bucket of its own (decision 6c), so never delete or overwrite anything under `fixtures/`, and no test cleanup may touch that prefix. `pnpm fixtures` does not read from there yet. INGEST-029 (shared test slides bucket) adds that and the read-only key for CI and production. Synthetic fixtures stay in git.
