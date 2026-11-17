# 0392. A deployed seed refuses to fall back to the flat fixtures folder, and Reset production publishes the fixture folders first

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas, proposed by the agent doing TEST-048 (format gallery slides open on the deployed app)
- Backlog: TEST-048. Changes [ADR 0367](0367-seeded-fixture-slides-get-their-own-folders.md) (seeded fixture slides get their own folders)

## Context

ADR 0367 let the seed fall back to `fixtures/<file>` when a gallery slide's `fixture-slides/<slug>/` folder was missing, so local and CI seeds keep working. No deploy or reset step ever ran the publisher, so the deployed seed fell back for all 39 gallery slides. The API then signed the folder `fixtures/`, the edge refused it as malformed, and every gallery slide on app.parfocal.eu said "You cannot open this slide". Nothing failed loudly anywhere along the way.

## Options

1. Keep the fallback everywhere and only run the publisher once by hand. The same silent failure comes back with the next bucket or environment.
2. Remove the fallback in every environment. Every local dev and CI seed would then need the multi-gigabyte fixture publish first.
3. Refuse the fallback only where the app is deployed, and make Reset production publish the folders before it empties anything.

## Decision

Option 3. With `APP_ENV` staging or prod the seed checks every gallery folder's `facts.json` before it touches the database and raises `MissingFixtureFoldersError` naming the missing files. Reset production runs `parfocal_ingest.fixture_slides` after the migration and before the truncate, so a failed publish leaves the data in place. The publisher keeps finished folders without needing the file, reads a missing local file from `fixtures/` in the same bucket, and exits non-zero when any slide stays unpublished. Local and CI seeds keep the fallback. A seed test reads the edge's `SHARED_FOLDER` rule from `capability.ts` and checks every seeded `original_key` against it.

The gallery's BIF becomes `OS-1.bif`, because `Ventana-1.bif` is refused by design (its frame overlap is unknown) and so can never get a folder.

## Consequences

A deployed seed can no longer write a slide the edge refuses. The first reset in a new bucket downloads and publishes each fixture once, which takes minutes. `OS-1.bif` adds about 3.9 GB to the slide bucket, about 0.06 dollars a month.
