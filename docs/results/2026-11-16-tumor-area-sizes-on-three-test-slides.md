# Result: tumor area sizes and stray areas on three annotated CAMELYON16 test slides and one normal slide

- Date: 2026-11-16
- Backlog: AITUM-003 (areas from the tumor map)
- Kind: ML evaluation
- Commit: the AITUM-003 commit on top of `5124bd7e` (`workers/ml/src/parfocal_ml/tumor_evaluation.py`, `workers/ml/src/parfocal_ml/tumor_areas.py`, `workers/ml/src/parfocal_ml/tumor_areas.toml`)
- Environment: Apple M4, macOS 15.8.1, CPU only, the workspace uv environment, shared with another agent's ML run
- Data: the stored tumor maps MLEVAL-005 (tumor map evaluation) cached in `~/.cache/parfocal/tumor-maps` for `test_001`, `test_013`, `test_065` and `test_062`, and the XML outlines of the `tumor-eval` fixture group. Neither the model nor the slides were used.

## Question

How far is the size AITUM-003 lists for a tumor area from the annotated size of the deposit under it, how many listed areas sit over no deposit, and what likely size range should replace the ±10% placeholder in `tumor_areas.toml`? MLEVAL-005 found a mean error of 1.69 mm, but it scored every outline polygon on its own and matched by overlapping boxes, and `test_001` draws one deposit as many polygons.

## Method

```
uv run --package parfocal-ml python -m parfocal_ml.tumor_evaluation \
  ~/.cache/parfocal/tumor-maps ~/.cache/parfocal/fixtures --out report.json
```

1. A deposit is a grown lesion, the same unit FROC counts: the tumor cells of the outlines on the 64 px grid, grown by 75 µm and labelled with 8-connectivity (`lesions_of` in `tumor_froc.py`). Each outline polygon joins the lesion that most of its cells fall in, so the 30 polygons of `test_001` become 5 deposits.
2. The true size is the widest distance across the convex hull of all vertices of a deposit's polygons, at the bundle's 0.243 µm/px. As a check, the hull of the deposit's grid cells is larger by 0.02 to 0.04 mm on every deposit, about two cells, as expected from cell corners.
3. An area belongs to a deposit when its cells touch that deposit's grown lesion. The POC's box overlap rule, which `evaluate_areas` keeps for the tumor_009 parity check, credited the 2.57 mm area to a 0.46 mm neighbour on `test_001`. The found size is the largest listed area over the deposit, as in the 2026-11-02 port result.
4. A deposit is missed when no listed area touches it. A listed area that touches no deposit, isolated ones included, is stray.
5. The likely size range scales the found size, so it comes from true size divided by found size over the matched deposits, taking the smallest and largest and rounding outward to two decimals.

## Results

Per deposit, largest first on each slide:

| Slide | True size | Isolated tumor cells | Largest listed area over it | Listed areas over it | Error | True over found |
|---|---:|---|---:|---:|---:|---:|
| test_001 | 3.942 mm | no | 2.570 mm | 5 | -1.371 mm | 1.533 |
| test_001 | 1.599 mm | no | 1.602 mm | 1 | +0.003 mm | 0.998 |
| test_001 | 0.460 mm | no | 0.432 mm | 1 | -0.028 mm | 1.064 |
| test_001 | 0.126 mm | yes | 0.139 mm | 1 | +0.013 mm | 0.905 |
| test_001 | 0.014 mm | yes | none | 0 | | |
| test_013 | 0.293 mm | no | none | 0 | | |
| test_013 | 0.143 mm | yes | 0.143 mm | 1 | +0.000 mm | 0.999 |
| test_065 | 0.528 mm | no | 0.537 mm | 1 | +0.009 mm | 0.983 |
| test_065 | 0.325 mm | no | none | 0 | | |
| test_065 | 0.080 mm | yes | 0.070 mm | 1 | -0.010 mm | 1.144 |

Pooled:

| Measure | Value |
|---|---:|
| Deposits | 10 |
| Matched | 7 |
| Missed | 3 |
| Mean absolute size error | 0.205 mm |
| Median absolute size error | 0.010 mm |
| True over found, smallest | 0.905 |
| True over found, largest | 1.533 |
| Largest without the fragmented deposit | 1.144 |

Stray areas, that is listed areas over no deposit:

| Slide | Listed areas | Stray |
|---|---:|---:|
| test_001 | 10 | 2 |
| test_013 | 2 | 1 |
| test_065 | 2 | 0 |
| test_062 (normal) | 1 | 1 |

FROC 0.722 and Dice 0.899 are unchanged from MLEVAL-005, since only the area matching changed.

## Interpretation

- With one deposit per grown lesion and matching by cells, six of the seven matched deposits are within 0.03 mm of their true size. The 1.69 mm mean that MLEVAL-005 reported was the polygon and box matching, not the map.
- The one large error is the 3.94 mm deposit on `test_001`. The map splits it into five listed areas, and the largest is 2.57 mm, so the listed size understates it by a third. This one deposit alone sets the upper end of the range, and a fragmented macro deposit is exactly where an understated size could move the category.
- The three missed deposits are 0.29 and 0.33 mm micro deposits on `test_013` and `test_065` and a 0.014 mm cluster on `test_001`. The two micro ones do have cells at or above 0.5 over them, but no peak reaches the 0.97 listing level. FROC still finds them as detections, so the area list is stricter than the map.
- Stray areas are 3 on the annotated slides and 1 on the normal slide, against 66 and 26 FROC false positives, because the 0.97 peak filter drops most false alarms.
- So the packaged range is now `below = 0.10` and `above = 0.54`: the true size was between 0.90 and 1.54 times the listed size for all 7 matched deposits. Without the fragmented deposit it would be 0.90 to 1.15. Seven deposits on three slides from two centres is a small sample, and the upper end rests on one deposit.

## Follow-ups

- Decision XXX in `docs/decisions.md` asks whether the fragmented deposit should set the upper end of the range.
- TODO: merge listed areas that touch one grown deposit when the map splits it, or list the hull over nearby pieces, so the found size of a fragmented macro deposit is not the largest piece. That is a change to the area rule, not to the evaluation, and needs more macro slides to measure.
- TODO: rerun on the wider set that MLEVAL-005 asks for, with a centre 0 macro slide, and update the range from it.
