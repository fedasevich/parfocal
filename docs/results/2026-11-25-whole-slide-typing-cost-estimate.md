# Result: typing every cell of a whole-slide run takes about 17 s per mm² on an M4 CPU, an estimated 350 to 830 s and 8 to 21 cents per slide on an L4

- Date: 2026-11-25
- Backlog: AINUC-016 (a whole-slide nucleus run types every cell)
- Kind: CPU benchmark and a GPU estimate. The GPU numbers are an estimate from earlier results, not a measurement, because the month's Modal budget is spent
- Commit: the AINUC-016 commits (`workers/ml/src/parfocal_ml/nuclei_run_worker.py`, `workers/ml/spike/run_typing_cost.py`)
- Environment: Apple M4, 24 GB, macOS 15, Python 3.14 through uv, onnxruntime 1.31.1 on `CPUExecutionProvider`. Other agents and a dev server shared the machine, so the four runs spread from 14.7 to 21.1 s per mm²
- Data: `CMU-1-Small-Region.svs` from the fixture cache (OpenSlide test data, public, no PHI), 2,220 by 2,967 px at 0.499 µm/px, nearly all tissue. The typer graph is the `hovernext-pannuke` v1.2 `typer.onnx` export at `~/.cache/parfocal/models/onnx/hovernext-pannuke.typer.onnx`

## Question

The run job now types every detected cell with the viewer's HoVer-NeXt typer after the detector. How much time does that add per slide on the L4 the `detector_best` pool runs on, and what does it cost?

## Method

```
uv run --all-packages python workers/ml/spike/run_typing_cost.py \
  ~/.cache/parfocal/fixtures/CMU-1-Small-Region.svs --repeats 2
```

It ran twice, two repeats each, the second time with a timer around the ONNX graph calls. The spike plans the run's tiles over the whole fixture slide as the job does (Best tier, tissue tiles only), finds cells in each tile window with a stand-in detector that thresholds dark pixels through the real PathoSAM post-processing, and times only `typed_cells`, the job's typing call, on each tile. That call groups the cells into 1,024 px windows, reads each window, resizes it to the typer's 0.25 µm/px, runs the graph and averages the class map inside every outline. The cells in a tile's halo are typed with the tile, as in the job. The typer's input is 16 million pixels per mm² at any slide resolution, so the rate carries over from this 0.5 µm/px slide to a 0.25 µm/px one. The rate is per mm² of planned tile area. The fixture is nearly all tissue, so the estimate applies it to tissue area.

The GPU speedup comes from two earlier results, both for the PathoSAM detector on 640 px windows, not for the typer's ConvNeXt-V2 network:

- The whole detector job took 333 s per mm² on the M4 CPU ([2026-11-06 detector throughput](2026-11-06-nuclei-detector-throughput.md)) and a projected 150 s per mm² on one L4 ([2026-11-16 L4 throughput](2026-11-16-nucleus-job-throughput-on-l4.md)), 2.2 times faster with CPU post-processing included.
- The 2026-11-06 run took 195.78 s for 36 windows on the M4, 5.44 s a window with post-processing included. The L4 spent 0.356 s a window on encoder and decoder alone. The ratio, 15.2, is not like for like. It is an upper bound for the network's speedup, because the CPU figure holds post-processing too.

The slide for the estimate is `test_001`, 61.27 mm² of tissue, from the 2026-11-16 L4 result. The price is the L4's $0.80 an hour base and $0.92 an hour in `eu`, from [knowledge/platform.md](../knowledge/platform.md).

## Results

| Run | Tiles | Cells typed | Tile area | Typing seconds | Graph seconds (calls) | Seconds per mm² | ms per cell |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 11 | 2,853 | 1.492 mm² | 21.99 | not timed | 14.73 | 7.71 |
| 2 | 11 | 2,853 | 1.492 mm² | 24.46 | not timed | 16.39 | 8.57 |
| 3 | 11 | 2,853 | 1.492 mm² | 25.01 | 18.06 (23) | 16.76 | 8.77 |
| 4 | 11 | 2,853 | 1.492 mm² | 31.49 | 22.34 (23) | 21.10 | 11.04 |

Mean 17.2 s per mm². The graph took 72% and 71% of the typing time in runs 3 and 4, so about 12.3 s per mm² is the graph and 4.9 s per mm² is CPU work around it (reads, resizes, outline masks, averages).

Estimate for `test_001` (61.27 mm²), arithmetic from the numbers above:

| Case | Seconds | Cost at $0.80 an hour | Cost at $0.92 an hour (`eu`) | Share of the detector's 9,198 s |
| --- | ---: | ---: | ---: | ---: |
| M4 CPU at the measured rate | 1,054 | | | |
| L4, graph 15.2 times faster, CPU part unchanged | 350 | $0.078 | $0.089 | 3.8% |
| L4, everything 2.2 times faster | 479 | $0.106 | $0.122 | 5.2% |
| L4, graph 15.2 times faster, CPU part 2.6 times larger for denser cells | 830 | $0.184 | $0.212 | 9.0% |

The last row allows for density: `test_001` stored 5,935 cells in 8 tiles of 0.147 mm², about 5,000 a mm², against 1,912 a mm² on the fixture. Whether the CPU part grows with the cells or with the windows was not measured, so that row is the worst case.

## Interpretation

- Typing adds an estimated six to fourteen minutes and 8 to 21 cents of L4 time to a slide whose detection takes about 2.6 hours. It does not change the run's cost much or the one-hour question of AINUC-011 (detector throughput).
- These GPU numbers are an estimate. The speedups were measured on the PathoSAM ViT-B, not the typer's ConvNeXt-V2 tiny, and the CPU part assumes Modal's CPU is as fast as the M4's. TODO: time the typer on the L4 the first time a run goes to the cloud with budget, and replace this table.
- About 29% of the typing time is CPU work a GPU does not speed up. Moving the resize into the graph or running typing on the next tile while the GPU detects would cut the L4 time, if the measurement shows it matters.
