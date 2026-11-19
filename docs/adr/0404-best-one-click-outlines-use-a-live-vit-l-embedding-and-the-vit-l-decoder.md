# 0404. Best one-click outlines use a live ViT-L embedding from the server and the ViT-L decoder in the browser

- Date: 2026-11-19
- Status: Accepted
- Deciders: claude (AISEG-024 parallel run), after the owner's answer B to decision 156 (what the Best model does for one-click outlines)
- Backlog: AISEG-024 (Best one-click outlines run PathoSAM ViT-L on the server). Builds on [ADR 0202](0202-v1-model-lineup-per-tier.md) (the v1 model line-up per tier) and [ADR 0377](0377-the-viewer-typer-runs-in-the-interactive-pool.md) (the viewer typer runs in the interactive pool)

## Context

Decision 156 gives Best the PathoSAM ViT-L encoder on the server, with the click decoder in the browser. Until now Best and Good both ran ViT-B. Three things had to be chosen: which decoder reads the ViT-L embedding, where the server gets the pixels of the clicked view, and what a person sees while the GPU container is cold.

A measurement settled the first. On the first TNBC image (55 nuclei) the ViT-L embedding decoded with the existing ViT-B decoder gave a mean IoU of 0.001 against 0.932 with the ViT-L checkpoint's own decoder ([result](../results/2026-11-19-best-one-click-outlines-vit-l-against-vit-b.md)). The two checkpoints do not share a decoder.

## Options considered

1. Send the ViT-L embedding to the browser's existing ViT-B decoder. No new browser file, and it does not work at all.
2. Export the ViT-L click decoder and its 32 token window decoder (16.5 MB each), serve them beside the other browser graphs, and let the engine remember which encoder made each embedding. The browser downloads 33 MB more the first time Best answers.
3. Decode on the server too. No browser file, but every click and every hover becomes a GPU round trip, which the one second target for a click cannot hold from a cold container.

For the pixels:

- a. The browser uploads the patch it already read. No slide read on the server, but 3 MB up for each view, and the server would trust pixels it did not read.
- b. The server reads the view from the slide's original, as the typer does. The request is four numbers.

## Decision

Option 2 with b.

`POST /api/slides/{slide_id}/embeddings/view` takes a rectangle in full resolution slide pixels, 16 to 4096 on each side and inside the slide. It checks slide reading like the typer route, answers 404 while the AI is hidden for the person, and sends a `view-embedding` call through the warm gate to the embedder pool (T4, `eu`, scale to zero). The runner reads the rectangle at full resolution, resizes it with the shared SAM preprocessing and runs `pathosam-vit-l` v1 `encoder.onnx` from model artifacts. The answer is the 1 by 256 by 64 by 64 embedding as little endian float16 (2,097,152 bytes) with the header `Parfocal-Encoder: pathosam-vit-l-histopathology-fp32`. While the pool has not answered, the route answers 202 with a call token and the browser asks again with it, the pattern of [the ADR on polled GPU calls](0404-a-gpu-call-answers-waiting-and-is-polled.md) (an interactive GPU call answers "waiting" and the viewer polls it). Any failure answers 503 `encoder-offline`. The audit row `view.embedded` holds the encoder, the GPU seconds and the waited seconds, never the rectangle.

In the browser, Best asks that route for each view smart select embeds. `adopt(id, embedding, "vit-l")` loads `pathosam-vit-l.decoder.onnx` and `pathosam-vit-l.decoder_window32.onnx` on first use and marks the embedding, so prompts on it use the ViT-L decoders and prompts on a browser embedding keep the ViT-B ones. The ViT-B nucleus decoder and the learner's pooling refuse a ViT-L embedding with an error.

Fallback to Good is per view. When the server has not answered in 6 seconds, answers an error, or the ViT-L decoder cannot load, the browser encodes that view with ViT-B, exactly as Good does, and a chip says "Best is not answering yet, Good outlined this view". The server is then skipped for 20 seconds. The waiting call is not cancelled. The browser keeps polling it, so it warms the container, and its arrival ends the pause. The smart layer carries `data-encoder` with `server` or `browser`.

Good is unchanged. Auto region is unchanged on both tiers, because its tiles go to the ViT-B nucleus decoder. The stored ViT-B tile cache stays as the second source for Best.

## Consequences

- Best costs GPU time: one encode for each view a person clicks in, on a T4 that stops after 5 idle minutes. The result file has the measured seconds.
- A view at a coarser pyramid level is read at full resolution on the server and scaled down there, so its pixels differ slightly from the level the browser reads. A view wider than 4096 full resolution pixels is not sent and Good outlines it.
- The picker text names ViT-L for Best on both tools, although Auto region does not use it yet. A ViT-L nucleus decoder for Auto region is a separate task.
- The runner downloads the slide's original on a cold start, as the typer does, in its own folder. Sharing one copy between the typer and the encoder is a follow-up.
