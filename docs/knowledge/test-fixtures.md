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
