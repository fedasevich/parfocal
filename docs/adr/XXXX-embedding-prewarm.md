# XXXX. The smart session encodes the view centre after 350 ms of stillness and shares one encode per patch

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-007 (embedding prewarm). Builds on [ADR 0253](0253-sam-inference-worker.md) (the inference worker keeps six embeddings) and [ADR 0255](0255-smart-select-gestures-and-proposals.md) (smart select gestures and proposals)

## Context

The encoder takes about 1.1 to 1.5 s on WebGPU and 5 s on WebAssembly (the AISEG-002 result file), while a click decode takes about 35 ms. A first click on a fresh view would otherwise wait for the encoder. The POC (doc 14) encoded the visible view once the camera rested.

## Options considered

1. The smart session owns the prewarm. It keeps one map from patch id to the encode promise, so a click and a prewarm of the same patch share a single encode.
2. A separate prewarm object beside the session with its own record of what is encoded.
3. Encode on every camera change and cancel the stale ones.

## Decision

Option 1.

- `createPrewarmTrigger` in `apps/web/src/aiseg/smart-prewarm.ts` waits 350 ms after the last camera or stage change, and calls `pause` on every change. The smart layer builds it while the tool is active, and it reads the slide point under the stage centre.
- `SmartSession.prewarm` reads the preset patch at that point and encodes it. The patch reader already keeps an anchor patch per level, so a click inside the prewarmed patch gets the same patch key and the same embedding id, and its decode starts at once.
- `SmartSession.pausePrewarm` makes a prewarm that is still reading its patch skip the encode. It does not abort the read, because a click can share the same in-flight read. An encode that already started runs to its end, since the worker cannot cancel a graph run.
- Ids the worker evicted from its six embeddings are removed from the session map, so a later click on an evicted patch encodes again.
- A prewarm failure is silent. The first click encodes as it did before.

## Consequences

- A click on a different patch while a prewarm encode is running waits for that encode, because the worker runs one graph at a time.
- Opening the smart tool now loads the model and the patch reader without a click.
- The first click on a prewarmed view costs one decode. The unit test uses a fake encoder of 900 ms and a fake decoder of 40 ms and requires the click to answer in under 150 ms. No real graph timing was measured in this task, so the real figure stays the decode time in the AISEG-002 result file.
