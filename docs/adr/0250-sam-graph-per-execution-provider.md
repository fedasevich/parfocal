# 0250. Each execution provider loads its own PathoSAM encoder, and both load the int8 weight-only AIS decoder

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-002 (quantised variants per execution provider). Builds on [ADR 0148](0148-browser-ml-runtime-onnxruntime-web.md) (browser models on onnxruntime-web 1.31.1) and [ADR 0246](0246-pathosam-onnx-export-contract.md) (PathoSAM ONNX export contract)

## Context

ADR 0148 picks WebGPU with the 4-bit `MatMulNBits` encoder when the browser has a GPU adapter and WebAssembly with the uint8 dynamic encoder otherwise. POC doc 14 found the uint8 graph 43 times slower on WebGPU and fp16 refused and larger than 4-bit. The AIS decoder, which the auto region tool runs, is 44 MB in fp32 and is all `Conv` and `ConvTranspose`, so `MatMulNBits` does not apply to it. The [result](../results/2026-11-06-sam-variants-per-provider.md) measured encode, click decode and AIS decode per provider in Chrome on an Apple M4.

## Options considered

For the AIS decoder, on both providers:

1. fp32, 44.2 MB. Fastest everywhere: about 1.0 to 1.5 s on WebGPU and 4.8 to 5.0 s on WebAssembly.
2. Weight-only int8 per output channel with `DequantizeLinear` in front of each weight, 11.1 MB. Mean foreground IoU 0.9994 against PyTorch, and 1 to 8 percent slower on WebGPU and 10 to 13 percent slower on WebAssembly than option 1.
3. Dynamic uint8 on `Conv`, 16.9 MB. `ConvInteger` has no WebGPU kernel, so it runs on WebAssembly only, 7 to 12 percent slower than option 1 there.
4. fp16. Refused by doc 14 for the encoder and not tried for the AIS decoder.

## Decision

`samVariant` in `@parfocal/viewer-engine` is the one place that names the graphs a provider loads.

- WebGPU loads `pathosam.encoder_q4.onnx`, WebAssembly loads `pathosam.encoder_uint8.onnx`, and both load `pathosam.decoder.onnx`.
- `graphRunsOn` refuses the uint8 encoder and the uint8 AIS decoder on WebGPU, so no caller can hand WebGPU a dynamic integer graph.
- Both providers load option 2 for the AIS decoder. A quarter of the download matters more on a first visit than a tenth of a second on a decode that already takes a second or more, and one AIS graph keeps the model cache to a single entry for it.
- The export writes eight graphs, the six of ADR 0246 plus the two quantised AIS decoders, and the Python gate requires a mean AIS foreground IoU of at least 0.96 for each.
- `pnpm --filter @parfocal/viewer-engine bench:sam` is the browser measurement. It skips when the graphs are not exported.

## Consequences

- An onnxruntime-web bump, a new export or a new quantisation reruns the bench and updates the result.
- If folding `DequantizeLinear` at session load removes the run time cost, option 2 has no downside left. If the auto region tool turns out to decode many patches per visit, option 1 may win and only `samVariant` changes.
- The uint8 AIS graph is exported and gated but loaded by nothing. It stays as a measured alternative and can be dropped from the export later.
