# Result: a parse runs in a network-blocked Modal sandbox, and what passing the file in costs

- Date: 2026-11-16
- Backlog: SEC-045 (isolate the remaining parse steps and run them in a Modal sandbox)
- Kind: spike
- Commit: 7be4a8b4 for runs 1 and 2, its follow-up commit on the same branch for run 3
- Environment: Modal environment `dev`, app `parfocal-parse-probe` (run 1 `ap-KFhMYxnjVh37wEBuialM01`, run 2 `ap-34IAngvgmDvQl3lcDodKKL`, run 3 `ap-MkgcMfbCBe6w7Y11GHZROc`), Modal 1.6.3, default CPU, sandbox memory `(3072, 3072)` MiB. The parse-user test ran in Docker `python:3.14-slim` as root on the Mac.
- Data: the synthetic fixture `synthetic-jpeg.tiff` (87,497 bytes) and a 100 MiB blob of random bytes. No PHI.

## Question

ADR 0325 (isolated parsing of uploaded files) left three things open. Does a sandbox built from the app image block the network, carry no secret and still run the real parser? How should the fetched file reach the sandbox, and what does that cost per check? Can the parse user read the worker's environment?

## Method

1. `bash workers/ingest/scripts/test-as-root.sh` runs `workers/ingest/tests/test_isolation.py` as root in a Linux container, which un-skips the parse-user test.
2. `uv run --package parfocal-deploy modal run -e dev -m parfocal_deploy.parse_sandbox_probe`, three times. Run 3 is the extended probe, which loads its launcher through `launcher_of` as the ingest worker does. Inside a Modal function the probe creates a sandbox with `PARSE_SANDBOX_OPTIONS` from `modal.Image.from_id` of the function's own hydrated image, then:
   - runs a script without the audit hook that opens a TCP connection to 1.1.1.1:443, resolves a name and lists its environment,
   - copies the fixture and the blob in with `filesystem.copy_from_local` and the blob back out with `copy_to_local`,
   - uploads the blob to an ephemeral `modal.Volume` and reads it from a second sandbox that mounts it,
   - runs `identify_upload` and `index_upload` end to end through `parse_isolated` with the sandbox launcher, one sandbox per call, and in run 3 also `scan_upload`, `validate_upload`, `derive_upload` and the patch export read `patch_slide` with its GeoJSON passed in as a declared input,
   - runs a 512 MiB allocation in a sandbox capped at 256 MiB, bare in every run and through `parse_isolated` in run 3,
   - in run 3, runs a parser that sleeps 120 s under a 10 s deadline, and a parser name that does not exist.

## Results

Boundary, the same in both runs:

| Check | Result |
|---|---|
| TCP connect from the sandbox, no audit hook | `OSError` |
| Name lookup | `gaierror` |
| Secret names in the sandbox environment | none, only Modal and image variables such as `MODAL_SANDBOX_ID`, `PATH`, `PYTHONPATH` |
| parfocal source in the sandbox | `/root/parfocal_ingest/parse_jobs.py` |
| `identify_upload` then `index_upload` | `generic-tiff`, 3 levels, the 669 byte level table copied back |
| Exit code when the memory cap is hit | 137 |
| Run 3, scan, validate, derive | clean, 3 levels, a 6,750 byte thumbnail copied back |
| Run 3, `patch_slide` | rows returned and a 210,875 byte patch zip copied back |
| Run 3, 512 MiB under a 256 MiB cap through `parse_isolated` | `unreadable`, not `parse-too-large` |
| Run 5 (`ap-W7p3MsPPAS2REIGS2q1UEz`), the same after the runner also reads the sandbox's own exit code | `parse-too-large` |
| Run 3, 10 s deadline | `parse-too-slow` after 10.4 s |
| Run 3, missing parser | `ParseNotStartedError` |
| Run 3, sandboxes of the app still listed at the end | one, not yet exited, and none after the app stopped |
| Parse-user test as root on Linux | passed, the child as `nobody` gets `PermissionError` on `/proc/<worker pid>/environ` |

Timings in seconds:

| Step | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `Sandbox.create` returns | 0.161 | 0.340 | 0.058 |
| First exec finishes (container start) | 3.336 | 2.841 | 2.203 |
| Copy the 87 KB fixture in | 0.396 | 0.507 | 0.056 |
| Copy 100 MiB in | 3.173 | 3.991 | 0.463 |
| Copy 100 MiB out | 7.726 | 9.677 | 0.854 |
| Upload 100 MiB to a Volume | 2.977 | 5.855 | 2.856 |
| New sandbox with the Volume mounted reads 100 MiB | 0.680 | 1.351 | 0.868 |
| `identify_upload` through a fresh sandbox, all in | 2.548 | 3.186 | 2.193 |
| `scan_upload`, all in | | | 2.752 |
| `validate_upload`, all in | | | 6.929 |
| `index_upload`, all in | 3.315 | 3.825 | 3.005 |
| `derive_upload`, all in | | | 2.181 |
| `patch_slide`, all in | | | 2.849 |

Cost as Modal's billing report showed it the same day: $0.00857 for run 1, $0.00882 for run 2, and $0.00055 for a first run that failed in its own probe script. TODO: runs 3 and 5 and a fourth run that failed on a wrong probe GeoJSON (`ap-nyZZgOs6jIjLJYKpzTHX1P`) were not in the report yet.

## Interpretation

- The sandbox is the kernel-level boundary the ADR wanted. A raw socket fails without the Python audit hook, and the sandbox holds no secret.
- The ingest workflow calls `parsed` once in each of five steps (identify, scan, validate, index, derive), so one slide starts five sandboxes. A container start was 2.2 to 3.3 s in these runs. The all-in step times of 2.2 to 6.9 s also hold the parse itself, so they are an upper bound on the start-up share.
- Copying 100 MiB in took 0.46 to 3.99 s across three runs, so the rate varies by almost ten times. Real slides are often 1 to 3 GiB and were not measured, so their transfer time is `TODO`.
- When the cap kills a child mid-parse, the exec's own wait reports no 137, but the sandbox's exit code does. The runner now checks both, and run 5 ended as `parse-too-large`.
- A per-job Volume uploads at a similar rate but would carry the file once for all five steps. Copying into each sandbox carries it five times. The runner uses `copy_from_local` now because it needs no new resource and no clean-up. It copies each fetched file once per sandbox.

## Follow-ups

- ADR 0325 (isolated parsing of uploaded files) is updated with these answers.
- TODO: measure a real 1 GiB slide through the whole ingest in the sandbox. If the five copies dominate, switch to one per-job Volume or one sandbox per job.
- Production was not touched. The sandbox reaches the `ingest` function at the next deploy of `parfocal_deploy.modal_app`.
