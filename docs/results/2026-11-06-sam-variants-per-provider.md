# Result: PathoSAM variants per execution provider in Chrome

- Date: 2026-11-06
- Backlog: AISEG-002 (quantised variants per execution provider)
- Kind: benchmark
- Commit: 9777067e plus the AISEG-002 change on its branch
- Environment: MacBook with Apple M4 (10 cores), macOS 15.8.1, Google Chrome 156 driven headless by `@playwright/test` 1.64.0 with `--enable-unsafe-webgpu`, onnxruntime-web 1.31.1. The WebGPU adapter reported vendor `apple`, architecture `metal-3`. The page was cross-origin isolated and WebAssembly ran 10 threads. Two other agents shared the machine during both runs, so times are indicative only
- Data: the graphs from `python -m parfocal_ml.sam_onnx.export` in `~/.cache/parfocal/models/onnx`. Browser input is a seeded pseudo-random 1 × 3 × 1024 × 1024 tensor, no slide pixels. Mask quality comes from the Python gate on the first 8 TNBC patches (public, no PHI)

## Question

How long do encode, click decode and AIS decode take for each graph on the provider that should run it? The task asks for 4-bit `MatMulNBits` on WebGPU, uint8 on WebAssembly, no fp16, never the uint8 graph on WebGPU, and a try at a quantised AIS decoder, which is 44 MB in fp32.

## Method

```
pnpm --filter @parfocal/ml export:sam -- --ais-only
pnpm --filter @parfocal/ml verify:sam -- --patches 8 --clicks 10
pnpm --filter @parfocal/viewer-engine bench:sam
```

The AIS decoder is 15 `Conv` and 8 `ConvTranspose` nodes and no `MatMul`, so `MatMulNBits` cannot shrink it. Two quantised AIS graphs were made instead.

- `pathosam.ais_decoder_uint8.onnx`: dynamic per-channel QUInt8 on `Conv`, which becomes `ConvInteger`. `ConvTranspose` stays fp32.
- `pathosam.ais_decoder_int8_weights.onnx`: weight-only symmetric int8 per output channel on every `Conv` and `ConvTranspose`, with a `DequantizeLinear` in front of each weight, so activations stay fp32 and every provider runs ordinary float kernels.

The bench page loads one provider per page load. It creates the decoder session and then the encoder session, encodes 5 times, decodes 12 clicks that move each time, releases both, then creates each AIS session in turn and decodes the last embeddings. Steady encode is the median of runs 3 to 5, steady decode the median of runs 3 to 12, steady AIS the median of runs 2 and later. The uint8 AIS graph was not run on WebGPU, by the rule above. The browser compares each AIS output with the fp32 one by largest absolute difference only. The seeded input gives no foreground at all, so a browser IoU would be trivially 1 and is not reported. The spec writes each report to `packages/viewer-engine/test-results/sam-bench/` and skips when a graph is missing.

## Results

Graph sizes: 4-bit encoder 72,564,336 bytes, uint8 encoder 100,742,890, decoder 16,495,823, fp32 AIS 44,153,923, uint8 AIS 16,875,125, int8 weight-only AIS 11,115,372.

Encode and click decode, in milliseconds:

| Provider and encoder | Run | Decoder session | Encoder session | Encode runs | Steady encode | Steady decode |
|---|---|---|---|---|---|---|
| WebGPU, 4-bit | 1 | not kept | not kept | not kept | 1,099 | 31 |
| WebGPU, 4-bit | 2 | 412 | 181 | 1,177, 1,915, 1,811, 1,454, 1,502 | 1,502 | 35 |
| WebAssembly, uint8 | 1 | not kept | not kept | not kept | 5,301 | 43 |
| WebAssembly, uint8 | 2 | 622 | 341 | 7,013, 6,106, 5,870, 5,962, 5,895 | 5,895 | 45 |

Run 2 decode runs on WebGPU were 110, 44, 37, 37, 37, 35, 37, 34, 33, 35, 33 and 35 ms, and on WebAssembly 62, 53, 47, 42, 52, 45, 45, 43, 44, 47, 43 and 41 ms. Run 1 printed only the steady values.

AIS decode on the last embeddings, steady, in milliseconds, with the largest absolute difference from the fp32 maps:

| Provider | AIS graph | Run 1 | Run 2 | Run 2 runs | Max abs difference |
|---|---|---|---|---|---|
| WebGPU | fp32 | 981 | 1,501 | 1,221, 1,326, 1,493, 1,501, 1,506 | 0 |
| WebGPU | int8 weight-only | 990 | 1,613 | 1,572, 1,580, 1,647, 1,581, 1,613 | 0.0127 |
| WebAssembly | fp32 | 4,836 | 5,020 | 5,028, 5,020, 4,997 | 0 |
| WebAssembly | uint8 dynamic | 5,162 | 5,621 | 5,070, 5,381, 5,621 | 0.0357 |
| WebAssembly | int8 weight-only | 5,457 | 5,532 | 5,753, 5,532, 5,443 | 0.0113 |

AIS mask quality against PyTorch, from the Python gate on 8 TNBC patches (onnxruntime 1.31.1 CPU):

| AIS graph | Max abs difference of the three maps | Min foreground IoU at 0.5 | Mean foreground IoU |
|---|---|---|---|
| fp32 | 1.54e-4 | 1.0 | 1.0 |
| uint8 dynamic | 0.0533 | 0.9988 | 0.9992 |
| int8 weight-only | 0.0226 | 0.9988 | 0.9994 |

The same gate run kept the encoder numbers of the [export result](2026-11-06-pathosam-onnx-export.md): mean IoU 0.9668 for the uint8 encoder and 0.9614 for the 4-bit one.

## Interpretation

- The provider split of [ADR 0148](../adr/0148-browser-ml-runtime-onnxruntime-web.md) (browser models on onnxruntime-web 1.31.1) holds with the graphs this repository exports. Run 1 matches the 1.1 to 1.3 s and 28 to 33 ms of the runtime spike. Run 2 is about 40 percent slower on encode, which follows the load from the other agents, not the graphs, because the graphs were the same bytes.
- Neither quantised AIS decoder is faster. On WebGPU the int8 weight-only graph costs 1 to 8 percent more and on WebAssembly 10 to 13 percent more, and the uint8 dynamic graph costs 7 to 12 percent more on WebAssembly. The likely cause is that onnxruntime keeps `DequantizeLinear` out of constant folding to preserve the QDQ form, so the weights are dequantised on every run. Not measured.
- The int8 weight-only graph is a quarter of the fp32 download (11.1 MB against 44.2 MB) at a mean foreground IoU of 0.9994, and it is the only quantised AIS graph that runs on both providers. The trade of download against run time is recorded in ADR XXXX (PathoSAM graph per execution provider).
- The first click decode after an encode still costs 110 ms on WebGPU in run 2, so the warm-up click of ADR 0148 stays.
- Assumption: a pseudo-random input times the same as a slide patch, because the graphs have no data-dependent control flow.

## Follow-ups

- TODO: fold the `DequantizeLinear` weights once at session load, or ship fp32 AIS where the download is cached, and rerun this bench.
- AISEG-003 (browser model cache) should cache the graph names `samVariant` returns.
- The 4-bit block size of 16 and accuracy levels other than 4, which the export result suggested, were not tried.
