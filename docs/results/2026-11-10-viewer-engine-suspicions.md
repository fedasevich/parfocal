# Result: three viewer engine suspicions settled

- Date: 2026-11-10
- Backlog: VIEW-066 (settle three viewer engine suspicions)
- Kind: check
- Commit: 562b8550
- Environment: the owner's Mac, `node --test` in `packages/viewer-engine`
- Data: generated OME-Zarr fixtures and a gated fake pixel source, no slide files

## Question

The [viewer engine review](2026-11-09-viewer-engine-review.md) left suspicions 2, 3 and 4 unproven because nothing was run. Is each one a real fault.

## Method

A check by an agent, with no second reader. For each suspicion a unit test was written first against the code as it stood. A test that failed proved the fault and the fix followed. Where no failing test could be written, the reason is given below.

## Results

| Suspicion | Outcome | Proof |
|---|---|---|
| 2. An OME-Zarr level with no declared scale gets a downsample that is not a power of two | Real, fixed | `test/pixel-source/zarr-unscaled-levels.test.ts`, 3 tests |
| 3. The patch reader ties a shared read to the first caller's abort signal | Real, fixed | `test/patch/patch-reader.test.ts`, 4 new tests |
| 4. The ids `hamamatsu-ndpi`, `ventana-bif`, `mirax` and `dicom` have no registered reader | True, but it cannot fail silently | Existing tests, named below |

Suspicion 2. A level stored as `floor(base / 2^k)` or `ceil(base / 2^k)` pixels gave a measured ratio such as 2.0008 when the multiscale metadata declared no scale. The source now snaps the ratio to the nearest power of two when the stored width is the floor or the ceiling of the base width divided by that power, and keeps the measured ratio otherwise. The same change makes the source refuse axes that list x before y, which it used to read with the two swapped.

Suspicion 3. Two callers asking for the same patch shared one read that carried the first caller's abort signal. When the first caller aborted, the second caller's read was aborted too. The shared read now has its own signal and stops only when every caller has aborted. A caller whose signal is already aborted is refused before any read starts.

Suspicion 4. No reader exists for these four formats, and that is the planned state. `test/pixel-source/registry.test.ts` asserts that the registry refuses each id by name, and `apps/web/src/viewer/open-failure.ts` turns the refusal into "This file format cannot be opened in the browser yet", which has its own test. So a slide in one of these formats shows a message and never a blank stage. VIEW-013 (NDPI including above 4 GB) and VIEW-014 (Ventana BIF with frame stitching) are open tasks, and MRXS and DICOM sit in the later list of the backlog.

## Limits

No real OME-Zarr store without declared scales was read, only generated fixtures. The engine unit suite ran after the change with 1,121 tests passing and 2 skipped.
