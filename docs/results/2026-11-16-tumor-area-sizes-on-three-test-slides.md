# Result: tumor area sizes and stray areas on three annotated CAMELYON16 test slides and one normal slide

- Date: 2026-11-16
- Backlog: AITUM-003 (areas from the tumor map)
- Kind: ML evaluation
- Commit: the AITUM-003 commits on top of `5124bd7e` (`workers/ml/src/parfocal_ml/tumor_evaluation.py`, `workers/ml/src/parfocal_ml/tumor_areas.py`, `workers/ml/src/parfocal_ml/tumor_areas.toml`)
- Environment: Apple M4, macOS 15.8.1, CPU only, the workspace uv environment, shared with another agent's ML run
- Data: the stored tumor maps MLEVAL-005 (tumor map evaluation) cached in `~/.cache/parfocal/tumor-maps` for `test_001`, `test_013`, `test_065` and `test_062`, and the XML outlines of the `tumor-eval` fixture group. Neither the model nor the slides were used.

## Question

How far is the size AITUM-003 lists for a tumor area from the annotated size of the deposit under it, how many listed areas sit over no deposit, and what likely size range should replace the ±10% placeholder in `tumor_areas.toml`? MLEVAL-005 found a mean error of 1.69 mm, but it scored every outline polygon on its own and matched by overlapping boxes, and `test_001` draws one deposit as many polygons.

## Method

```
uv run --package parfocal-ml python -m parfocal_ml.tumor_evaluation \
  ~/.cache/parfocal/tumor-maps ~/.cache/parfocal/fixtures --out report.json
```

1. A deposit is one 8-connected piece of annotated tumor on the 64 px grid. Overlapping or touching polygons fall into one piece, so the 30 polygons of `test_001` become 11 deposits, the 6 of `test_065` become 4, and the 2 of `test_013` stay 2.
2. The grown lesions of FROC (75 µm) were tried first as the unit and rejected. On `test_001` the growing chains 7 separate annotated pieces into one 3.94 mm lesion whose largest piece is 2.54 mm, and the map's 2.57 mm area then looked like a 1.37 mm error that the annotation does not support. The grown lesions are still used to mark deposits of isolated tumor cells and to tell stray areas apart.
3. The true size is the widest distance across the convex hull of the vertices of the deposit's polygons, at the bundle's 0.243 µm/px. As a check, the hull of its grid cells is larger by 0.02 to 0.04 mm on every deposit, about two cells, as cell corners should be.
4. Each listed area is credited to the deposit its cells cover most. The found size is the largest area credited to a deposit, as in the 2026-11-02 port result. A deposit that an area touches but is credited to a neighbour is merged. A deposit that no listed area touches is missed. The POC's box overlap rule, which `evaluate_areas` keeps for the tumor_009 parity check, had credited the 2.57 mm area to a 0.46 mm neighbour.
5. A listed area that touches no grown lesion is stray.
6. The likely size range scales the found size, so it comes from true size divided by found size over the matched deposits, taking the smallest and largest and rounding outward to two decimals.

## Results

Matched deposits:

| Slide | True size | Isolated tumor cells | Largest listed area credited | Areas credited | Error | True over found |
|---|---:|---|---:|---:|---:|---:|
| test_001 | 2.523 mm | no | 2.570 mm | 3 | +0.047 mm | 0.982 |
| test_001 | 1.786 mm | no | 1.777 mm | 2 | -0.009 mm | 1.005 |
| test_001 | 1.599 mm | no | 1.602 mm | 1 | +0.003 mm | 0.998 |
| test_001 | 0.460 mm | no | 0.432 mm | 1 | -0.028 mm | 1.064 |
| test_001 | 0.126 mm | yes | 0.139 mm | 1 | +0.013 mm | 0.905 |
| test_013 | 0.143 mm | yes | 0.143 mm | 1 | +0.000 mm | 0.999 |
| test_065 | 0.528 mm | no | 0.537 mm | 1 | +0.009 mm | 0.983 |
| test_065 | 0.080 mm | yes | 0.070 mm | 1 | -0.010 mm | 1.144 |

Deposits without their own area:

| Slide | True sizes | Outcome |
|---|---|---|
| test_001 | 0.413 mm | merged into the 2.570 mm area of its neighbour |
| test_001 | 0.158, 0.057, 0.047, 0.040 and 0.014 mm | missed |
| test_013 | 0.293 mm | missed |
| test_065 | 0.136 and 0.131 mm | missed |

Pooled:

| Measure | Value |
|---|---:|
| Deposits | 17 |
| Matched | 8 |
| Merged | 1 |
| Missed | 8 |
| Mean absolute size error | 0.015 mm |
| Median absolute size error | 0.010 mm |
| Largest absolute size error | 0.047 mm |
| True over found, smallest | 0.905 |
| True over found, largest | 1.144 |
| True over found without isolated tumor cell deposits | 0.982 to 1.064 |

Stray areas, listed areas that touch no annotated lesion:

| Slide | Listed areas | Stray | Stray sizes, all isolated tumor cell size |
|---|---:|---:|---|
| test_001 | 10 | 2 | 0.078 mm at peak 0.992, 0.070 mm at peak 0.976 |
| test_013 | 2 | 1 | 0.113 mm at peak 1.000 |
| test_065 | 2 | 0 | |
| test_062 (normal) | 1 | 1 | 0.147 mm at peak 0.980 |

FROC 0.722 and Dice 0.899 are unchanged from MLEVAL-005, since only the area matching changed.

## Interpretation

- Every matched deposit is within 0.05 mm of its true size, which is three grid cells of 15.6 µm. The 1.69 mm mean that MLEVAL-005 reported came from scoring polygons and matching boxes, not from the map.
- Both ends of the range come from deposits of isolated tumor cell size. The 0.905 is a 0.013 mm error on a 0.126 mm deposit and the 1.144 a 0.010 mm error on a 0.080 mm deposit, both under one cell. For micro and macro deposits alone the ratio stays within 0.98 to 1.07. A relative range is widest exactly where the grid is coarsest.
- So the packaged range is now `below = 0.10` and `above = 0.15`: the true size was between 0.90 and 1.15 times the listed size for all 8 matched deposits on three slides from two centres. That is a small sample.
- All four stray areas are under 0.15 mm, against 66 and 26 FROC false positives, because the 0.97 peak filter drops most false alarms. No stray area is micro or macro sized.
- The missed deposits are all under 0.3 mm. The grown lesions of the 0.293 mm one on `test_013` and of the two pieces on `test_065` have cells at or above 0.5 over them, but no peak reaches the 0.97 listing level, and FROC still finds them as detections. The area list is stricter than the map.

## Follow-ups

- Decision XXX in `docs/decisions.md` asks whether the range should stay relative or become a fixed margin of about one cell for small areas.
- `cell_areas.py` reads the same `likely_size()`, so areas built from cells now also carry 0.90 to 1.15, which was measured on the tumor map only.
- TODO: rerun on the wider set that MLEVAL-005 asks for, with a centre 0 macro slide, and update the range from it.
