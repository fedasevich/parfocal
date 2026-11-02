# Decisions waiting for the owner

Last updated: 2026-11-02

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What your answers of 2026-11-02 changed

| Answer | What changed |
|---|---|
| 10b, reviewers see labels on their task slides | `see-labels` is now "In their tasks" for a project reviewer, and ADR 0124 (labels and macros) says so |
| 5b, largest upload | 100 GiB, which is 6,400 parts of 16 MiB |
| 14a, ingest memory | The worker requests 2 GiB with a 4 GiB hard limit |
| 4d, cell sample size | Already a setting: 200 is only the template's preset, and a task takes any count from 1 to 10,000 |
| 4a, built-ins | The five built-ins stay defined in code and seeded into every workspace, so they come from one place and a workspace can still add its own |
| 7a, summary of older records | [One page](project/standing-approval-records.md) for ADR 0054 to ADR 0091 |
| 3a, mutes | Kept as built, because muted notifications still show in the inbox. ADR 0119 (inbox mutes) is accepted, and disagreements ready gets through a mute |
| 4c, the two forms | The reader study and segmentation built-ins carry the Reader study form and the Outline quality form as drafted |
| 6c, test slides | They go once into `parfocal-dev`, and production and CI read them there with a read-only key |
| Follow-ups | New tasks for a cap of 3 claims per job, first read questions, a task scope as a list, the two missing forms and the shared test slides bucket |

Every other answer took the recommended option, and ADR 0117 (review order), 0118 (blinding), 0120 (study templates), 0121 (S3 client), 0122 (slide row when ready), 0123 (model runs), 0124 (labels), 0125 (result pairing), 0126 (cell chunks), 0127 (imported cell numbers) and 0128 (streamed result files) are accepted. The blank 12a, 13b and 14b took the recommended option.

## 6. Real infrastructure

### 6a. `tofu apply` on the R2 dev bucket `parfocal-dev` for INGEST-028 (upload protocol check on R2)

You wrote yes here. The rules count only a yes in chat for the exact plan, so the plan diff and its cost will be shown in chat first and applied after your yes there.

## 16. Names inside slide files, SEC-028 (identifying text in de-identified originals)

### 16a. How a de-identified project keeps a slide file's own text out of reach

PROJ-002 (privacy modes) asked that an upload arrives without the names in its file metadata, such as the `Filename` field of an SVS ImageDescription. Parfocal stores nothing from that text, but the viewer will read the original file by byte ranges through TILES-001 (signed access to slide bytes), and you chose in 10e that the stored original keeps the bytes and SHA-256 of the upload.

- A. Ingest records the byte ranges of the identifying text tags, and in a de-identified project the edge serves those ranges with the text replaced by spaces of the same length. **Recommended**, because it matches 10e, the stored file stays as uploaded, and the viewer still finds every tag it needs, such as the pixel size, which sits outside the blanked fields
- B. Ingest writes a cleaned copy of the original for de-identified projects and serves only that, which doubles the storage of those slides
- C. Refuse an upload to a de-identified project when its metadata holds a name-like field
- D. Other

Your choice:

## 17. Slide files

### 17a. Barcodes in file headers

TILES-001 (signed access to slide bytes) closes the label and macro pages of the original, but the Leica SCN header, an XML block in the first IFD that every viewer must read, holds the slide barcode (`<barcode>` in `Leica-1.scn`). A task reviewer who may not see labels could read it through the tile path. ADR 0137 (capability tokens for slide bytes) records the gap.

- a. (recommended) Ingest also closes header fields that hold a barcode, and the viewer reads the slide's geometry from `levels.json` instead of the file header for those formats. Needs a small reader change in SKEL-006 (open the slide in Viv).
- b. Leave it, because the barcode is an accession code without a name, and add it to ADR 0124 (labels and macros) as a known gap.
- c. Serve SCN slides only to whole-project readers until a or b.

Your choice:

## Notes, no decision needed

- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
