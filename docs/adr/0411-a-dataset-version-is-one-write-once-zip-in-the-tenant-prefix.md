# 0411. A dataset version is one write once zip in the tenant prefix

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude, on the owner's answers to decision 169 (what a dataset version is) and decision 170 (which objects go into a dataset by default)
- Backlog: PROTO-115 (a dataset page with filters and stored versions)

## Context

`GET /api/review-tasks/{id}/training-dataset` (EVAL-014, the training dataset export, ADR 0262) builds a zip of QuPath GeoJSON and a manifest each time it is called. Two downloads a day apart can differ, so nothing says which data trained a model. The owner chose option A of decision 169: a frozen, write once copy of the manifest and the GeoJSON with a number, a note, the filters, who, when and a checksum, with patches cut again on demand. Decision 170 says that by default only objects a person checked go in (added, agreed and edited), and that open objects are left out and counted. The rebuild is not byte for byte, because `zipped()` stamps each entry with the time and the manifest carries `created_at`.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Store the filters only and rebuild on download | No storage | Not byte for byte, and later edits or a removed class change the data under the same number |
| 2. One object per file, the manifest and each slide's GeoJSON | Patches could read one slide's file | Many writes per version, and a version is only whole if every write landed |
| 3. One zip per version holding the manifest and every GeoJSON, written once, and a row with the number, note, filters, counts, who, when, SHA-256 and size | One write, the download is the stored bytes, the checksum covers the whole version | A version is a few kilobytes to a few hundred kilobytes in R2 for ever |

## Decision

Option 3.

- The key is `t/{tenant}/datasets/{task}/{version id}.zip` under `storage_prefix`, so a tenant's deprovisioning removes it with the rest. It uses the row's UUID, not the number, so an object left by a failed transaction never blocks a number.
- The write uses `put_new_object`, which sends `If-None-Match: *`. R2 and the local MinIO refuse a second write to the key with 412, which a test checks.
- Migration 0145 adds `dataset_versions` with tenant isolation, `UNIQUE (task_id, number)` and only SELECT and INSERT for the app role. Freezing locks the task row and takes the next number.
- Every download checks the stored bytes against the row's SHA-256 and refuses with `dataset-version-changed` if they differ. The response carries `X-Checksum-Sha256`.
- `dataset()` takes optional filters: origins among added, agreed and edited, project classes, signed off slides and "include unchecked". Without filters it gives what it gave before. Objects with no project class go in only while no class filter is set. The manifest of format 2 gains `classes` and `filtered_out` per slide, `filtered_out`, `filters` and `dataset_version`. They are additions, so the format number stays 2.
- The page starts from decision 170: checked objects only, whatever the task's own unchecked option says. The plain training dataset download keeps following the task's option.
- `POST .../patch-exports` takes an optional `dataset_version`. The job then reads the frozen zip, checks its SHA-256 and cuts tiles from its GeoJSON, and the patch manifest names the version.
- The note is classed as PHI, because it is free text.

## Consequences

- Measured on the seeded "Annotation example" task, one signed off slide: the default version of 17 checked objects is about 2,860 bytes, and the version with the 4,388 unchecked AI objects included (4,405 objects) is about 400,260 bytes ([result](../results/2026-11-21-dataset-version-size.md)). At R2's $0.015 per GB a month that is under $0.000001 a month per version, and a thousand of the larger ones stay inside the free 10 GB.
- Nothing deletes a version. If retention ever must, it runs as the table owner and deletes the object by key.
- An object left by a freeze whose transaction failed stays in storage unnamed. It is a few kilobytes and is removed with the tenant.
- Review tasks get versions when PROTO-118 (a signed off review task becomes a final layer) feeds the same builder.
