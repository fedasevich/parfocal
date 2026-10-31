# 0117. The least sure first order is stored per task slide when the task is made

- Date: 2026-10-31
- Status: Proposed
- Deciders: Claude, waiting for the owner
- Backlog: GUIDE-012 (least sure first order), GUIDE-013 (review order as a background job), GUIDE-002 (guided review), TASK-003 (scope and progress), AINUC-006 (calibration), AILEARN-005 (recalibration after each round), STACK-025 (object storage, CDN and signed access), AIP-013 (result chunk store)

## Context

GUIDE-012 (least sure first order) asks that each reviewer's objects in a task, cells as well as regions, come in ascending order of the model's certainty, with ties broken by object ID and unscored objects after the scored ones in the task's fixed random order. A later recalibration must not reshuffle a running review ([ADR 0114](0114-thesis-assignment-tasks.md), tasks the thesis assignment adds).

What exists today:

- Result sets are immutable and a task pins one set per slide ([ADR 0077](0077-result-sets.md), result sets, and [ADR 0078](0078-review-task-model.md), review task model). Regions and zones sit in `result_objects` with a nullable `score` and `probabilities` from 0 to 255. Cells sit in `PFC1` chunk files with one `result_chunks` row per chunk ([ADR 0076](0076-annotation-and-ai-result-storage.md), annotation and AI result storage). Each cell carries its own number, class, detection score and ring, and `probs` when the source has them. The chunk `score` is a required byte, so a chunk cannot say that a cell has no score.
- Nothing writes or reads chunk bytes yet. The ingest workflow's steps are placeholders, and the storage choice is STACK-025 (object storage, CDN and signed access).
- There is no calibration in the product. Storing a temperature per typer is AINUC-006 (calibration), and a recalibration in AILEARN-005 (recalibration after each round) will change it. Temperature scaling can change how two objects rank against each other.
- TASK-003 (scope and progress) picks the objects in scope with `in_scope`, samples random cells with a generator seeded by the task's seed and the slide, and stores the seed only for the random cells scope. Nothing in the API applied a scope before this change.
- Task creation enqueues no job, and the job engine is [ADR 0044](0044-background-jobs-and-workflows.md) (background jobs and workflows on Postgres).

## Options considered

1. Compute the order on every read. No new storage, but once a temperature exists the order follows whatever temperature is current, which is the reshuffle GUIDE-012 (least sure first order) forbids, and every read of a cell scope reads chunk files.
2. Freeze the inputs: store a seed and the calibration used when the task was made, and compute on read. Cheap to store, but there is no calibration to freeze yet, every read still reads chunk files, and every reader must keep the same code and Python shuffle for the life of the task.
3. Store one row per ordered object. Simple to read, but a cells below a score scope on a 1.6 million cell slide means hundreds of thousands of rows per task slide, and [ADR 0076](0076-annotation-and-ai-result-storage.md) (annotation and AI result storage) keeps per-cell data out of Postgres on purpose.
4. Store the finished order as one packed array per task slide, computed once after the scope is applied. One row per task slide, five bytes per ordered object, immune to later changes of temperature, code or inputs, and pageable by byte offset.

## Decision

Option 4, storing one packed array per task slide. `review_order` (migration `0040`, review order) holds one row per task slide with the seed, the object count and `objects`, a `bytea` of five bytes per object: the object's letter and its number as a little-endian unsigned 32-bit integer. The rows belong to the task slide and not to a reviewer, so every reviewer of a slide reads the same order by construction and the table holds no personal data.

- Scope first. The order covers only the objects in the task's scope, picked with `in_scope` as TASK-003 (scope and progress) defines it. All regions reads no chunk files. Random cells reads every chunk of the set into compact arrays and samples with the same `sample` call `in_scope` makes, so 200 cells on a large slide order 200 cells. Cells below a score reads every chunk and filters chunk by chunk. Inside regions of interest and unsure zones read only the chunks whose tile meets a region of interest or a zone.
- Certainty. A region's certainty is the stored probability of its AI class when it has probabilities and a class inside them, else its score, else none. A cell's certainty is its chunk's `probs` byte for its AI class. A chunk without `probs`, which imports may write, and a cell whose class is 255 (unclassified) give unscored cells. Cells do not fall back to the detection score, because the chunk format has no way to mark a score as absent, while a region's score column can be null. The cells below a score scope filters on the detection score, as the POC's filter did (POC doc 28, calibrated type confidence), not on the certainty. The chunk's unsure flag (bit 0 of `flags`) is not used here. The unsure zones scope means zone geometry.
- Inside. A region is inside a region of interest when it intersects one. A cell is inside a region of interest or a zone when the mean of its ring's vertices lies within it. Regions of interest are the slide's undeleted `roi` annotations, whoever drew them, and zones are the pinned set's zones. Containment runs in PostGIS on the centres of one chunk at a time, because neither Python package has shapely.
- Order. `least_sure_first` sorts scored objects by certainty and then by object key, which puts cells before regions as `in_scope` already sorts, and shuffles the unscored ones with `random.Random(f"{seed}:{slide}")`, the generator TASK-003 (scope and progress) samples with.
- Reading chunks. `parfocal_common.result_store` has a `ResultStore` protocol with one method, `get(object_key) -> bytes`, and `LocalResultStore`, which reads files under `RESULT_STORE_DIR` (default `.results`) and refuses keys that leave it. Gzipped chunks, as ADR 0076 (annotation and AI result storage) stores them, and plain ones both read. A chunk row whose file is missing refuses the task with 409 `result-files-missing`. Buckets, a CDN and signed access stay STACK-025 (object storage, CDN and signed access), which adds an S3 reader behind the same protocol.
- When. `createReviewTask` draws one seed, uses it for the random cells sample and the order, and stores every slide's order in the same transaction. A scope change through `changeReviewTask` rebuilds the order with the stored seed, because the stored order is the old scope's. Nothing else rebuilds it.
- Reading the order. `GET /api/review-tasks/{task}/slides/{slide}/order` (`getReviewOrder`) returns the total and a page of at most 1,000 objects from an offset, sliced in Postgres, to whoever may read the task slide, as the verdict list does.

Computing the order inside task creation is accepted for now, because local and pilot slides are small and a [result file](../results/2026-10-31-review-order-large-slide.md) puts a 1.6 million cell slide at 0.4 to 0.8 seconds for a random 200 cells and 1.3 to 2.7 seconds for a cells below a score scope on a laptop, without file or database time. GUIDE-013 (review order as a background job) moves it onto the ADR 0044 job engine for real slides.

## Consequences

- When AINUC-006 (calibration) adds a temperature, `store_order` calibrates the probabilities before rating objects, and running tasks keep the order they were made with.
- A scope change rebuilds the order with the calibration current at that moment. That is the owner's explicit change, not a reshuffle behind a reviewer's back.
- Tasks made before migration `0040` have no order rows and the endpoint returns an empty page for them, which is acceptable because no shared database holds running tasks.
- Until something writes chunk files into the store, only tests put files there. AIP-013 (result chunk store) and STACK-025 (object storage, CDN and signed access) decide where real files go, and the reader follows.
- GUIDE-002 (guided review) shows the objects in this order, page by page.
