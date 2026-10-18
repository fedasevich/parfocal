# Evaluation metrics

How `parfocal_common.evaluation` turns verdicts, decisions and reviewed layers into the numbers of the evaluation report ([ADR 0084](../adr/0084-evaluation-metrics.md)).

## The engine takes plain inputs

The functions take `AiObject` (slide, kind, number, AI class, each reviewer's `Verdict` and the decision on it), `Added` (an object a reviewer added, already deduplicated across reviewers) and `Areas` (per slide and class, the AI area, the consensus area and their overlap). They do no database or geometry work, so the API and the export worker can both call them. Whoever gathers the inputs computes the areas, with PostGIS (`ST_Area(ST_Intersection(...))` over `ST_Union`) or shapely.

## Rules worth remembering

- The consensus is the unanimous verdict, else the decision (`keep-ai` is agree, `go-with-reviewers` is disagree), else undecided. Unsure and undecided objects are counted but kept out of precision and sensitivity.
- A disagree consensus is also a false negative for another class only when every disagreeing verdict is `wrong_class` with the same class.
- Every rate is a `Ratio` with its numerator and denominator, and a zero denominator gives `None`, never 0.
- Cohen's kappa is computed per pair of reviewers over the objects both judged, with agree, disagree and unsure as categories. `fleiss` reproduces the textbook example (κ ≈ 0.210, 10 subjects, 14 raters, 5 categories), and returns `None` when the subjects do not all have the same number of raters.
- The fixture `packages/py-common/tests/fixtures/evaluation-task.json` holds the hand-computed values. The two reviewers there give κ = 51/87.

## The task evaluation endpoint gathers the inputs

`GET /api/review-tasks/{id}/evaluation` (`parfocal_api.evaluation`) is for project owners and viewers, and reviewers get 403 `evaluation-hidden`. It builds the engine inputs from the database:

- AI regions take their class from the result set's class list, mapped to the project class when there is a mapping. Cells have no class in the database, because their classes are in the chunk files, so they count as `unclassified` until the cell summary is in storage. TODO: read cell classes from the summary then.
- Added objects from different reviewers are merged when two regions overlap at IoU 0.5 or two cells' centroids are within 16 px, because slides have no stored pixel size yet ([ADR 0071](../adr/0071-object-id-grammar.md) asks for 4 µm).
- Region areas come from one PostGIS query per slide and class: the union of the AI's regions, the union of the agreed regions (reshaped where a reviewer reshaped them) and the added regions, and the area of their intersection. The task does not store an order of reviewers, so the reshape that counts is the earliest one saved, not "the first reviewer in task order" as ADR 0084 puts it.
- Opinions are summarised per question of the task's pinned form.

## The geometric scorer counts pixels as squares on a 4x grid

`parfocal_ml.scoring` rasterises each predicted ring by centre sampling on a 4x supersampled grid, where a label pixel's centre sits on its integer coordinate, so its edges are at ±0.5. A ring through the boundary pixels' centres covers only part of the nucleus (9 of 16 fine cells for a 4-pixel square), and a ring on the true edge scores 1. A ground-truth nucleus more than half inside the ignore mask is dropped, and so is a ring mostly inside it. The POC's stored `region.all.json` is stale for `classical-batch` and `pathosam-auto-hv`, so compare against the POC scorer itself, not that file ([result](../results/2026-10-18-geometric-scorer-reproduction.md)).

## Datasets come through the registry

`parfocal_ml.datasets.REGISTRY` lists every evaluation dataset with its role, licence, source and citation ([ADR 0093](../adr/0093-evaluation-metrics-and-datasets.md)). `fetch` downloads an archive into `~/.cache/parfocal/datasets/<name>/` (or `PARFOCAL_DATASETS_DIR`) and refuses it unless its size and MD5 match what Zenodo publishes, and `samples(name)` reads images, instance labels, vague areas and the organ or slide straight from the zip. A dataset without a public download raises `ManualDownloadError` with its source. An archive that is already on disk can be symlinked into the cache under the published file name. TNBC v1.1 has three nuclei fewer than the copy the POC used ([result](../results/2026-10-18-dataset-loaders.md)).
