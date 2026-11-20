# Result: how long Best in Smart select waits for its embedding

- Date: 2026-11-20
- Backlog: PROTO-135 (Best in Smart select answers or says why it cannot)
- Kind: measurement
- Commit: the deployed app at v0.32.0 (release commit 631b81ee) was measured. The fix is in the PROTO-135 commit on top of it and is not deployed yet.
- Environment: app.parfocal.eu (development, ADR 0390, the deployed app is dev), signed in as the agent test account through `scripts/agent_session.py`. The client was a Python HTTP script on the owner's Mac over home broadband, not the browser.
- Data: the gallery slide CMU-1-Small-Region.svs in Scanner format comparison, a public test slide with no PHI.

## Question

Issue 4 of the v0.29.1 walkthrough (Best never answered in Smart select) saw two POST /embeddings/view calls get no reply within 10 seconds, and Smart select fell back to Good with no reason. How long does the Best embedding take cold and warm, and why did the client give up?

## Method

Each run posts one 512 by 512 view at level 0 to `POST /api/slides/{id}/embeddings/view`, as the web client does after a click on Best. A 202 reply is followed by the same POST with `?call=` and the token from the reply, until a 200 arrives. The script records the status and wall time of each round and the total. The cold run was the first call of this session, at 21:59 UTC. Its 202 shows the pool was not answering within the 45 s hold. The warm runs followed it straight after, each on a new view so no cache could answer.

## Results

| Run | View (x, y, side) | Rounds (status, seconds) | Total seconds | Body |
| --- | --- | --- | --- | --- |
| Cold | 512, 512, 512 | 202 after 45.96, then 200 after 4.62 | 50.57 | 2,097,152 bytes, ViT-L encoder |
| Warm 1 | 1024, 1024, 512 | 200 after 4.59 | 4.59 | 2,097,152 bytes, ViT-L encoder |
| Warm 2 | 1536, 512, 512 | 200 after 6.49 | 6.49 | 2,097,152 bytes, ViT-L encoder |
| Warm 3 | 512, 1536, 512 | 200 after 4.61 | 4.61 | 2,097,152 bytes, ViT-L encoder |
| Refused | 999999, 0, 512 | 404 view-outside after 0.34 | 0.34 | problem body, no GPU call |

The times include the 2 MB download to the Mac. There is one cold sample and three warm ones. How much of the cold time is the GPU start and how much the region of the pool (ADR 0407, GPU pools in any region) is not separated: TODO, the Modal call log would split it.

Code facts read alongside. The server holds each request up to 45 s (`HOLD_SECONDS` in `apps/api/src/parfocal_api/gpu_calls.py`) before it answers 202. The web client raced each Best call against 6 s (`viewTimeoutMs` in `apps/web/src/aiseg/view-embeddings.ts`), then used Good and skipped the server for 20 s with no reason shown. The GPU wait notice is published only after a 202, so it could never appear before the client gave up.

## Interpretation

Cold, the 6 s race always lost, because the first reply comes after 46 s. Warm, Best takes 4.6 to 6.5 s, so even a warm Best lost the race now and then (warm run 2). An assumption, not observed: the two posts per click in the walkthrough were the prewarm at the view centre plus the click itself, since Smart select prewarms the centre once the view is still.

The fix drops the race. Best waits for the GPU and answers once warm. After 8 s with no answer, just past the slowest warm run, the client shows the same GPU wait as the other GPU calls, counting seconds and with Cancel. It gives up after 3 minutes, a choice of about three cold starts, not a measured limit. Every fallback to Good now names its reason (refused, GPU not answering, waited 3 minutes, wait stopped, view cannot be sent). After the last three the session forgets the Good stand in, so the next click on the same view asks Best again. Closing Smart select, switching to Good or leaving the slide stops any open Best call. A Cancel before the first 202 stops the browser's request, but the server is not told, because no call token exists yet. The server already logs each call in the OPS-038 (GPU wait log) format with `gpu_kind` view-embedding, `waited_seconds` and `slow_wait`, so no server change was needed.

GPU calls made for this result: four view embeddings (one cold, three warm). The refused view started none. Cost: TODO, not read from Modal usage.

## Follow-ups

- After the next deploy, check on app.parfocal.eu that Best shows the GPU wait and then a proposal, cold and warm. Not verified yet.
- TODO: split the cold time into GPU start and region from the Modal log.
