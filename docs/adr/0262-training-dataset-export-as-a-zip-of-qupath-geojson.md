# 0262. Training dataset export as a zip of QuPath GeoJSON

- Date: 2026-11-08
- Status: Accepted
- Deciders: Claude
- Backlog: EVAL-014

## Context

[ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) and [ADR 0238](0238-check-options-and-presets-on-annotate-tasks.md) (check options and presets on annotate tasks) ask for the signed-off slides of an annotate task as GeoJSON per slide plus a manifest. [ADR 0258](0258-confirmed-ai-objects-as-shared-layer-copies.md) (confirmed AI objects as shared layer copies) adds that a deleted `ai-confirmed` row means unchecked, not deleted. Training code outside Parfocal reads the files, so their shape is hard to change once people depend on it.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. One zip with `manifest.json` and `slides/{slide id}.geojson` in QuPath's GeoJSON shape | One download, QuPath and the Parfocal importer both read each file, the manifest checksums every file | The whole zip is built in memory |
| 2. A manifest endpoint plus one endpoint per slide file | Streams large slides | Many requests, and the manifest and files can drift apart between calls |
| 3. One GeoJSON file for the whole task | Simplest | QuPath opens one image per file, and a slide's objects cannot be checked on their own |

## Decision

Option 1, at `GET /api/review-tasks/{task_id}/training-dataset`, for people who see the whole task.

- Only signed-off slides are exported. With none the answer is `nothing-signed-off`.
- Each feature has a UUID `id`, `properties.objectType` (`annotation`, or `cell` for cells), `properties.classification` with the class name and its colour as an RGB list, and `properties.parfocal` with the object ID, its full path, the kind, the origin, the class key, the source AI object, and the author and last changer as letters.
- Author letters follow the order people were assigned to the task, so they stay the same across slides, and anyone else, such as an owner changing a signed-off slide, gets the next letter. No user ID or name is written.
- Origins follow [ADR 0258](0258-confirmed-ai-objects-as-shared-layer-copies.md). A live copy keeps its origin, a deleted `ai-edited` copy and its AI object leave the dataset, and an AI region or cell with no live copy, or with an undone confirm, is unchecked. Unchecked objects are left out and counted, or written as `ai-unchecked` when the task's check options include them.
- Only regions of interest, regions and cells are exported. Arrows, text notes and rulers are marks for people, so they are counted as `marks_left_out` and note words never reach the file.
- A copy with no class of its own takes the class its AI object has through the result set's class mapping. Names, keys and colours come from the task's class snapshot.
- The manifest is a strict Pydantic model holding the format and version, the task, the coordinate space (level-0 pixels), the kinds, the origins, the class snapshot, the check options, the annotators as letters, and per slide the microns per pixel, the level-0 size, the result set, the sign-off time and signer letter, the counts by origin, the left-out counts, and the path, size and SHA-256 of its file.

## Consequences

- Files name slides by ID, but `parfocal.path` carries the project code, case label and slide label, as the other exports do.
- A very large whole-slide run builds its zip in memory. If that becomes a problem, the per-slide files can move to a streamed zip without changing the format.
- Patches with label masks stay with EVAL-015 (patch and mask export).
