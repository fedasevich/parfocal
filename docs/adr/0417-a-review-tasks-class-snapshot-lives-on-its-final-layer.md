# 0417. A review task's class snapshot lives on its final layer

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-144 (patches and the dataset carry class names and stay small)

## Context

The deployed walkthrough of v0.34.1 found that patches with masks and COCO from a review task held no labels and that the dataset page showed class IDs. The dataset builder took its classes from `review_tasks.class_snapshot`, and the check `class_snapshot` on that table makes the column null for every review task, because only an annotate task copies the project classes when it is created. So the manifest's `classes` was empty, every `class_key` was null and the patch worker dropped every object as unclassed.

## Options considered

- Give review tasks a snapshot on `review_tasks` too. That means dropping the check, backfilling old tasks and changing every reader that takes a null snapshot to mean a review task, such as `task_of` and the web app's class lists.
- Read the live project classes at every export. No storage, but a renamed or recoloured class would change what an existing build exports.
- Store the project classes on each final layer row when the layer is built, and fall back to the live project classes for rows built before the column existed.

## Decision

- Migration 0150 adds a nullable JSON column `classes` to `final_layers`. Every build writes the project classes, in key order, on each of its rows.
- The dataset builder takes a review task's classes from its current final layer, and the live project classes when that layer has none. An annotate task keeps its own snapshot.
- The dataset summary gains `class_names`, the snapshot the counts were made with, so the dataset page names each class for a review task.

## Consequences

- Masks, COCO categories and the manifest of a review task carry the classes the sign off was built with, and a new build picks up later class changes.
- Frozen dataset versions stored before this change keep their null class keys. A new freeze is needed to cut labelled patches from them.
- The app role still only selects and inserts on `final_layers`, so old rows are never rewritten.
