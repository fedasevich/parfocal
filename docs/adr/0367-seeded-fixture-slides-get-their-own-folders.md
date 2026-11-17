# 0367. Seeded fixture slides get their own folders under fixture-slides/, with a server-side copy of the original beside their derived files

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas, proposed by the agent doing TEST-037 (seeded fixture slides open in the deployed viewer)
- Backlog: TEST-037. Builds on TEST-020 (showcase seed and the Reset production workflow) and on the shared sample folders of ONB-007 (sample slide files)

## Context

The showcase seed points its format gallery at the public fixtures in `parfocal-dev/fixtures/`, one flat folder. The deployed viewer cannot open them. The edge reads a slide's original and its derived files from one folder named by the capability token, and it accepted a shared folder only under `samples/camelyon16/`. The fixtures have no `levels.json`, `tile-index.json` or `restricted-ranges.json`.

A flat `fixtures/` folder cannot serve as that folder. All twelve slides would share one `levels.json` and one `restricted-ranges.json`. The API also fails closed when `restricted-ranges.json` is missing and marks every byte restricted. And the edge checks ranges only on the original, so a token for `fixtures/` could read every other fixture whole.

## Options considered

- Give each slide its own folder with a copy of the original. Each gallery file gets `fixture-slides/<slug>/` holding its derived files, `facts.json` and `original<suffix>`, copied server-side from `fixtures/`. The edge needs one more tight folder rule and the API's tile access is unchanged. It costs about 1.75 GB of extra R2 storage, about $0.03 a month.
- Keep derived files only in the new folders and add a second token claim for the original's folder. This needs no copy, but the capability token, the API signer and the edge all grow a new claim, and the original would be read from a folder the token shares with every other fixture.
- Ingest each gallery file as an upload per tenant. This is real ingest, but it copies every original into every tenant on every reset, which is about 5 GB per reset and needs the ingest worker running in production.

## Decision

Own folders with a server-side copy. The slug is the file name with every character outside `[A-Za-z0-9_-]` replaced by a hyphen, so `CMU-1.ndpi` and `CMU-1.tiff` stay apart. The edge's shared-folder rule now accepts `fixture-slides/<slug>/` beside `samples/camelyon16/<label>/`. `python -m parfocal_ingest.fixture_slides` writes each folder once. It never overwrites or deletes: derived files go in with `If-None-Match`, the original is copied only when absent, `facts.json` is written last and marks a finished folder, and `--dry-run` lists what it would write. The seed reads `facts.json` and falls back to the old `fixtures/<file>` key when a folder is missing, so local and CI seeds keep working. The synthetic `synthetic-zlib.ome.tiff` joins the gallery as its OME-TIFF slide, uploaded from the repository because `fixtures/` has no OME-TIFF.

## Consequences

- The reset leaves `fixture-slides/` alone, because it empties only `t/`, and its test now says so.
- `fixtures/` itself is never written by this work.
- MIRAX and DICOM gallery slides get their folders, but the viewer engine has no pixel source for them yet, so they still do not open in the browser. Uploaded zips go through the same default pixel source registry, which registers neither format.
- Seeded tenants keep their old keys until the next reset, so the folders must be written before the reset runs.
