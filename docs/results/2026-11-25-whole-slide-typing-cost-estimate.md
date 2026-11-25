# Result: typing every cell of a whole-slide run takes about 15.6 s per mm² on an M4 CPU, an estimated 63 to 435 s and 1 to 11 cents per slide on an L4

- Date: 2026-11-25
- Backlog: AINUC-016 (a whole-slide nucleus run types every cell)
- Kind: CPU benchmark and a GPU estimate. The GPU numbers are an estimate from earlier results, not a measurement, because the month's Modal budget is spent
- Commit: the AINUC-016 commit (`workers/ml/src/parfocal_ml/nuclei_run_worker.py`, `workers/ml/spike/run_typing_cost.py`)
- Environment: Apple M4, 24 GB, macOS 15, Python 3.14 through uv, onnxruntime on `CPUExecutionProvider`. Other agents and a dev server shared the machine
- Data: `CMU-1-Small-Region.svs` from the fixture cache (OpenSlide test data, public, no PHI), 2,220 by 2,967 px at 0.499 µm/px. The typer graph is the published `hovernext-pannuke` v1.2 `typer.onnx` export from `~/.cache/parfocal/models/onnx/hovernext-pannuke.typer.onnx`

## Question

The run job now types every detected cell with the viewer's HoVer-NeXt typer after the detector. How much time does that add per slide on the L4 the `detector_best` pool runs on, and what does it cost?

## Method

```
uv run --package parfocal-ml --extra tumor --all-groups python workers/ml/spike/run_typing_cost.py \
  ~/.cache/parfocal/fixtures/CMU-1-Small-Region.svs --repeats 2
```

The spike plans the run's tiles over the whole fixture slide exactly as the job does (Best tier, tissue tiles only), finds cells in each tile window with a stand-in detector that thresholds dark pixels through the real PathoSAM post-processing, and times only `typed_cells`, the job's typing call, on each tile. That call groups the cells into 1,024 px windows, reads each window, resizes it to the typer's 0.25 µm/px, runs the ONNX graph and averages the class map inside every outline. The cells in a tile's halo are typed with the tile, as in the job. The typer's input is 16 million pixels per mm² at any slide resolution, so seconds per mm² carry over from this 0.5 µm/px slide to a 0.25 µm/px one.

The GPU speedup comes from two earlier results, both for the PathoSAM detector on 640 px windows, not for the typer's ConvNeXt-V2 network:

- The whole detector job took 333 s per mm² on the M4 CPU ([2026-11-06 detector throughput](2026-11-06-nuclei-detector-throughput.md)) and a projected 150 s per mm² on one L4 ([2026-11-16 L4 throughput](2026-11-16-nucleus-job-throughput-on-l4.md)), 2.2 times faster. This includes CPU post-processing, so it is the low end.
- The network alone took about 5.4 s a window on the M4 CPU (the same 2026-11-06 result) and 0.356 s a window for encoder and decoder on the L4 (the 2026-11-16 result), 15.2 times faster. This is the high end, since the typer also does CPU work (resize, outline masks, averages) that a GPU does not speed up.

The slide for the estimate is `test_001`, 61.27 mm² of tissue, from the 2026-11-16 L4 result. The price is the L4's $0.80 an hour base and $0.92 an hour in `eu`, from [knowledge/platform.md](../knowledge/platform.md).

## Results

| Run | Tiles | Cells typed | Tile area | Typer seconds | Seconds per mm² | ms per cell |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 11 | 2,853 | 1.492 mm² | 21.99 | 14.73 | 7.71 |
| 2 | 11 | 2,853 | 1.492 mm² | 24.46 | 16.39 | 8.57 |

Mean: 15.6 s per mm² on the M4 CPU.

Estimate for `test_001` (61.27 mm²), arithmetic from the numbers above:

| | Seconds | Cost at $0.80 an hour | Cost at $0.92 an hour (`eu`) | Share of the detector's 9,198 s |
| --- | ---: | ---: | ---: | ---: |
| M4 CPU, measured rate | 956 | | | |
| L4 at the whole-job speedup of 2.2 | 435 | $0.097 | $0.111 | 4.7% |
| L4 at the network speedup of 15.2 | 63 | $0.014 | $0.016 | 0.7% |

## Interpretation

- Typing adds about 1 to 11 cents and one to seven minutes of L4 time to a slide whose detection takes about 2.6 hours, so it does not change the run's cost or the one-hour question of AINUC-011 (detector throughput).
- These GPU numbers are an estimate. The speedups were measured on the PathoSAM ViT-B, not the typer's ConvNeXt-V2 tiny. TODO: time the typer on the L4 the first time a run goes to the cloud with budget, and replace this table.
- The stand-in detector found 2,853 cells on the fixture. PathoSAM finds a different number, but the typer's cost follows the window pixels much more than the cell count, because the graph runs once per 1,024 px window and the per-cell average is cheap.
