# Test fixtures

Slides for tests. Large public slides are downloaded into a cache with checksums, and tiny synthetic slides are committed in `synthetic/`. Every fixture is listed in [fixtures.json](fixtures.json) with its SHA-256 and size.

## Fetching

```
pnpm fixtures                 # the small group, about 6 MB, which CI fetches
pnpm fixtures formats         # one slide per POC-supported format, about 2.4 GB
pnpm fixtures camelyon big    # several groups at once
pnpm fixtures all             # everything, about 25 GB
```

| Group | Contents |
|---|---|
| `small` | `CMU-1-Small-Region.svs`, the MIRAX `CMU-1-Saved-1_16.zip` and the CAMELYON16 annotation XML for `tumor_009` and `test_001` |
| `formats` | One OpenSlide test slide per format the POC read: Aperio SVS (JPEG and JPEG 2000), generic TIFF, NDPI, Leica SCN, Ventana BIF, DICOM, Huron, Argos, Philips TIFF and Zeiss CZI |
| `big` | Whole scanned slides at native magnification, 0.3 to 3.9 GB each |
| `huge` | `Hamamatsu-1.ndpi`, 6.9 GB |
| `camelyon` | CAMELYON16 `tumor_009.tif` (a training slide), `test_001.tif` and both annotation XML files |

Files land in `~/.cache/parfocal/fixtures`, or `$XDG_CACHE_HOME/parfocal/fixtures`, or `$PARFOCAL_FIXTURES_DIR` when set. Downloads go to a `.part` file first, resume with range requests after a dropped connection and are renamed only after the SHA-256 matches. A `.sha256` file next to each fixture records that it was verified, so later runs skip hashing. Run the command again to resume anything that failed.

To use slides that are already on disk, set `PARFOCAL_FIXTURES_LOCAL` in the root `.env` to one or more folders separated by `:`. A file there with the right size and SHA-256 is symlinked into the cache instead of downloaded, and the command prints `linked`. A copy that fails the check is skipped and the file is downloaded.

The sources are the [OpenSlide test data](https://openslide.cs.cmu.edu/download/openslide-testdata/), whose `index.json` publishes a SHA-256 per file, and the [CAMELYON16 bucket](https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/README.md) on AWS Open Data, which publishes MD5 sums. The CAMELYON16 SHA-256 values were computed after the files matched those MD5 sums.

## Using fixtures in tests

TypeScript tests import the helpers:

```ts
import { fixturePath, syntheticPath } from "@parfocal/test-fixtures";

const slide = fixturePath("CMU-1-Small-Region.svs");
const tiny = syntheticPath("synthetic-jpeg.tiff");
```

`fixturePath` throws with the `pnpm fixtures` command to run when the file is not downloaded. Python tests read the same `fixtures.json` and cache directory.

## Synthetic slides

| File | Format |
|---|---|
| `synthetic-jpeg.tiff` | Generic tiled TIFF, JPEG tiles of 256 px, three levels from 1024 × 768, 0.5 µm per pixel |
| `synthetic-zlib.ome.tiff` | OME-TIFF with the same pyramid in SubIFDs and deflate tiles |

The image has a grid every 128 px, an L-shaped mark in the top left and a block in the bottom right, so flips and rotations show. Each level is the 2 × 2 mean of the level above. Regenerate them with

```
uv run --no-project --python 3.14 --with tifffile --with numpy --with imagecodecs packages/test-fixtures/scripts/make_synthetic.py
```

which also rewrites the `synthetic` checksums in `fixtures.json`. The OME-XML holds a random UUID, so every run changes the checksums.
