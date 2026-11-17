# Result: the first full test:accuracy run on the Mac passes 396 tests and fails one benchmark that needs its own variable

- Date: 2026-11-17
- Backlog: TEST-028 (model accuracy tests that cannot be skipped unseen)
- Kind: check
- Commit: 0ca625b2, with no change under `workers/ml`
- Environment: MacBook with Apple M4 (24 GB), Darwin 24.6.0, Python 3.14 from `uv sync --all-packages` in a fresh worktree, CPU only. One-minute load average 2.69 before and 7.16 after, and up to about 14 during the run while other agents worked. No browser or other test ran at the same time.
- Data: model weights, ONNX graphs and datasets from `~/.cache/parfocal` (public datasets such as TNBC, NuInsSeg, CryoNuSeg, MoNuSeg and PanNuke, and the POC caches). No PHI.

## Question

Does `pnpm --filter @parfocal/ml test:accuracy` run every `workers/ml` test with the files required on the owner's Mac, and what does one full run show?

## Method

One run, from the worktree root:

```
nice -n 10 pnpm --filter @parfocal/ml test:accuracy -rA --durations=25 --junitxml=accuracy.xml
```

`-rA`, `--durations` and `--junitxml` only add reporting. The wall time and memory came from `/usr/bin/time -l`.

## Results

| Measure | Value |
| --- | --- |
| Tests collected | 397 |
| Passed | 396 |
| Skipped | 0 |
| Failed by error | 1 |
| Wall time | 2007.56 s (33 min 27 s) |
| CPU time, user and system | 7263.80 s and 547.61 s |
| Largest resident memory | 9,517,219,840 bytes (about 9.5 GB) |

The one error is `test_whole_slide_main_path.py::test_main_path_whole_slide_run_after_a_warm_up`. It skips unless `PARFOCAL_MAIN_PATH_MODEL_RUNS` is set, and with `PARFOCAL_REQUIRE_WEIGHTS=1` that skip fails, as the command is meant to make it. The test is a whole-slide timing benchmark against a local MinIO at `127.0.0.1:9000`, not an accuracy check, and it was not run separately.

The tests assert their thresholds and print few numbers. The numbers printed in this run:

| Test | Printed |
| --- | --- |
| nuclei throughput, BEST quality | 0.25 µm per pixel, 1399 nuclei in 202.88 s over 0.5875 mm², 345.3 s per mm² |
| nuclei throughput, FAST quality | 0.33 µm per pixel, 1267 nuclei in 181.96 s over 0.5875 mm², 309.7 s per mm² |
| stand-in whole-slide run of 1536 by 1536 | fastest of 3: 720 ms |

Among the passes are the weights and dataset checks: InstanSeg above its floor on TNBC and its export matching TorchScript, the HoVer-NeXt typer export matching torch and typing PanNuke well above chance, the PathoSAM ONNX graphs matching PyTorch and the quantised encoders and decoders staying close, the windowed SAM decoder agreeing with the full one on TNBC, the auto region and the prompt fallback meeting their TNBC baselines, the scorer reproducing the POC numbers on TNBC for HoVer-Net, PathoSAM and VISTA-2D, the stored ViT-B lineup predictions reproducing the POC held-out numbers on TNBC, NuInsSeg and CryoNuSeg, and the ResNet-18 view map tests.

The slowest tests were the prompt fallback on TNBC (957.82 s), the auto region on TNBC (254.98 s), the two throughput tests (208.88 s and 186.40 s) and the setup of the PathoSAM ONNX comparison (182.20 s).

## Interpretation

The command does what TEST-028 asks: nothing skipped unseen, and every model, graph and dataset was found. As written, though, it can never pass, because the main path benchmark has an opt-in variable that `PARFOCAL_REQUIRE_WEIGHTS=1` turns into a failure. TODO: either mark that benchmark so `test:accuracy` leaves it out, or set its variable and start MinIO in the command. The run took a third of an hour and about 9.5 GB, so it suits the one-at-a-time rule in `knowledge/agent-workflow.md`.
