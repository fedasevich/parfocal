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
