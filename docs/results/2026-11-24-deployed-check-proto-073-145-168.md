# Result: deployed check of PROTO-073, PROTO-145 and PROTO-168 on v0.51.0

- Date: 2026-11-24
- Backlog: PROTO-073 (guided steps and Smart select stay in sensible bounds), PROTO-145 (whole slide cell detection starts, and a review shows only its own runs), PROTO-168 (a queued whole slide run starts within its promised time)
- Kind: deployed check
- Version: v0.51.0, commit 9ade2c8, named by `/api/status` as the release
- Environment: app.parfocal.eu (a development environment by ADR 0390), headless Chromium through Playwright at 1440 by 900, the account agent-walk in the seeded workspace cvut-biomedical (checked with `GET /api/me` before each run), no PHI
- GPU calls made: 2 of the 3 allowed, see the end

## Question

Do the three tasks in review meet their "Done when" lines on the deployed app?

## Method

The session came from `scripts/agent_session.py` into `walk-session.json`. Scratch Node and Playwright scripts (kept in the session scratchpad, not committed) read the API with the session cookie and drove one headless browser at a time. Before the Best call `modal app list --env main` showed `parfocal-gpu-pool` with 0 tasks and its logs showed the last container at 17:14, so the pool had been idle for 43 minutes. The embedder pool scales down after 300 s (`INTERACTIVE_SCALEDOWN_SECONDS`) and the detector pools after 60 s. No screenshot was taken.

What the check left in the dev app: the result set "PathoSAM + HoVer-NeXt v1.2" on CMU-1-Small-Region.svs in P03 (0 cells, 0 regions, see below), one Best layer in the viewer that was never saved, and the job of the run. The next reseed removes them.

## Results

### PROTO-073, guided steps. Pass

The review task RT-12 "Walk guided scan power check" (P03) has CMU-1-Small-Region.svs (20x) and Huron-1-40x.tif (40x). In its guided mode I stepped through the three objects of each slide with Skip for now and read the camera from `data-camera` of `slide-host` (log2 scale, 0 is the scan's native pixel) and the magnification label of the viewer.

| Slide | Step | Object | Camera zoom | Label |
|---|---|---|---|---|
| CMU-1-Small-Region.svs (20x) | 1, 2, 3 | C314, C553, C1172 | -0.0029 each | 20x |
| Huron-1-40x.tif (40x) | 1, 2, 3 | C48, C100, C321 | -0.3219 each | 40x |

No step went above native and the label never passed the scan power, where the audit of 2026-11-19 saw 118x and 321x. The annotate guided check (the other half of audit row 24) was not walked.

### PROTO-073, Best on a cold pool. Pass, with one finding

One click with Smart select on Best on CMU-1-Small-Region.svs, with the pool idle for 43 minutes and 0 tasks. The click was at about 17:57:30 (the give up came 90.7 s later and Modal logged the cancel at 17:59:01).

- The first 60 s were not captured (the script output was cut by a pipe to `tail`). From 60 s the page showed the GPU wait notice with a running count (60 s, 61 s, up to 89 s) and the chip "Asking Best's GPU, N s".
- Modal started the container at 17:58:47, 77 s after the click.
- At 90.7 s the wait ended on its own. The notice and chip changed to "Outlining", and the note read "No GPU answered Best in 90 seconds, Good outlined this view. Click again to ask Best again" (reason `gave-up`).
- Good outlined the view. The chip counted "Outlining, 1 s" to "5 s", then "Outline found" at 95.9 s with 1 proposal, 5.2 s after the give up. Total from click to outline 95.9 s.
- No console error.

So the wait ends with a clear message and the Good outline within 90 s and about 96 s in all. The earlier "keeps saying Best is not answering with no end" no longer happens.

Finding: Modal's log at 17:59:01 reads "Received a cancellation signal while processing input" and "This shuts down the container". The embedder container had been up for 14 s when the page's give up cancelled the call, so a cold start longer than 90 s is cancelled each time and the next Best click probably starts cold again. That was not tested, because it would need one more GPU call.

### PROTO-145, a review lists only its own runs. Pass

The run of PROTO-168 (below) created the result set 3437e588 on CMU-1-Small-Region.svs, which RT-12 does not use (RT-12's set on this slide is 181b7477, "Cell typer v1", 1,418 cells, `run_set_ids` empty). I read the same slide from RT-12 and on its own at three moments, while the run was queued (18:03), while it ran (18:31) and after it finished (18:33).

| Moment | `/api/slides/{id}/ai-progress` with no set | the same with RT-12's set | RT-12 page: AI reading and notices | The slide on its own |
|---|---|---|---|---|
| Queued | running, 3 steps | ready, no steps | state ready, no text, no notices | notice "The result set PathoSAM + HoVer-NeXt v1.2 v1.2 is still importing. Its objects show when it is ready." |
| Running (4 of 11 tiles) | running, 3 steps | ready | the same | the same notice |
| Finished | ready | ready | the same | no notice |

The RT-12 page asked only `ai-progress?result_set_id=181b7477…` and never showed the other run, its progress or its importing notice. The slide opened without a task shows the importing notice of the other set. The task detail of RT-12 still lists only its own sets after the run. No API answer of 400 or more and no console error.

- The done line of PROTO-145 also asks for a whole slide run that starts and finishes with its time and cost logged. It started and finished, see PROTO-168. The cost is only estimated, see the GPU calls.
- "A test covers a run with no tiles planned" and "one Best click makes one GPU call" are not deployed checks. For Best, the head of the output with the request lines was lost, so it was not counted this time. Modal logged one cancelled input for the container.
- The run finished with a result set of 0 cells and 0 regions (`cell_count` 0, `region_count` 0), as the earlier run on synthetic-zlib.ome.tiff did. The seeded Cell typer finds 1,418 cells on the same slide, so an empty result looks wrong. It is not investigated here.

### PROTO-168, a queued run starts within its promised time. Fail on the start time

One run of "PathoSAM + HoVer-NeXt" on CMU-1-Small-Region.svs in P03, started from the Run a model dialog (`/projects/P03/run-model`), which is the smallest seeded slide that sits in a review task (synthetic-zlib.ome.tiff is smaller but no task covers it).

What the dialog promised before the click: "About 21 min, done around 18:21", with "About 2 min a slide on the Parfocal GPU. 0 runs are ahead of yours, about 0 min. About 19 min of the estimate is waiting for a GPU to start." The models list read `start_minutes` 19.

| Time (CET, UTC in the log) | What the app said |
|---|---|
| 18:01:28 (17:01:28Z) | POST `/model-runs` answered 201, job 27f3e004, queued, `wait` reason `waiting-for-gpu` since 17:01:27Z |
| 18:01 to 18:31 | `/api/me/jobs` read queued with 0 units the whole time and the same `wait`. The Jobs tray read "queued since 18:01" and "Waiting for a GPU". |
| 18:14:15 | Modal log: "Function 'detector_best' is waiting to be scheduled on a GPU_L4 worker. We are actively working on acquiring more capacity" |
| 18:26 | The models list now read `runs_ahead` 1, `queue_minutes` 17, `start_minutes` 19 |
| 18:31:05 (17:31:05Z) | running, 0 of 11 tiles, `wait` null (the pool showed 1 task by 18:32) |
| 18:31:16 to 18:32:12 | 0, 4, 8, 11 of 11 tiles |
| 18:32:18 (17:32:18Z) | done, 11 of 11 tiles, `finished_at` 17:32:18.6Z |

- Queued for 29.6 min against a promised 19 min wait, so 10.6 min late. Done after 30.9 min against a promised 21 min.
- The run itself took 73 s for 11 tiles.
- The cause is the same as in the walk of v0.46.0, and PROTO-168's own commit named it: Modal had no free L4 for `detector_best`. This time the wake worked and the page said "Waiting for a GPU", but the wait was longer than the measured 19 minutes.
- Passes: the job and tray say why it waits, and the dialog's estimate names the GPU start wait. Fails: the run did not start within the estimate.

## GPU calls

1. Best embedding of a view on CMU-1-Small-Region.svs at 17:57:30 CET on a cold embedder pool. The Modal container ran from 17:58:47 to 17:59:01 (14 s, T4 class), cancelled by the give up. Estimated cost about $0.002 (14 s at a T4 rate), not read from Modal billing.
2. One whole slide run, PathoSAM + HoVer-NeXt on CMU-1-Small-Region.svs, 11 tiles, 73 s of GPU time on an L4. Estimated cost about $0.02 (73 s at an L4 rate), not read from Modal billing. TODO: read the real cost from the Modal usage page.

The third call was not used.

## Interpretation

PROTO-073 and PROTO-145 meet their deployed checks, with two follow-ups. PROTO-168's cause is still capacity, so the start wait cannot be promised from a past measurement.

## Follow-ups

1. A run waited 29.6 min for an L4 against a promised 19 min (PROTO-168). The estimate comes from the last measured wait, which is not a promise. Either the dialog says the GPU start is not guaranteed and may take much longer, or `detector_best` runs on a GPU class with free capacity, or the estimate uses a high percentile.
2. A cold Best start is cancelled at 90 s, which kills the container that was starting, so the next click is cold again (PROTO-073). Test it with one more GPU call, then consider keeping the embedder warm for a while after a cancel or giving a cold start more than 90 s.
3. The finished run's result set holds 0 cells and 0 regions on two different slides (PROTO-145).
4. The annotate guided check and the first 60 s of the cold Best wait were not captured. A rerun on a cold pool with the script writing straight to a file would close that.
