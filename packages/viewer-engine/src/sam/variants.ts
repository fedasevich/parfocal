export type SamProvider = "webgpu" | "wasm";

export const samGraphs = {
  encoderQ4: "pathosam.encoder_q4.onnx",
  encoderUint8: "pathosam.encoder_uint8.onnx",
  decoder: "pathosam.decoder.onnx",
  aisDecoder: "pathosam.ais_decoder.onnx",
  aisDecoderUint8: "pathosam.ais_decoder_uint8.onnx",
  aisDecoderInt8Weights: "pathosam.ais_decoder_int8_weights.onnx",
} as const;

export type SamGraph = (typeof samGraphs)[keyof typeof samGraphs];

export interface SamVariant {
  readonly provider: SamProvider;
  readonly encoder: SamGraph;
  readonly decoder: SamGraph;
  readonly aisDecoder: SamGraph;
}

const variants: Readonly<Record<SamProvider, SamVariant>> = {
  webgpu: {
    provider: "webgpu",
    encoder: samGraphs.encoderQ4,
    decoder: samGraphs.decoder,
    aisDecoder: samGraphs.aisDecoderInt8Weights,
  },
  wasm: {
    provider: "wasm",
    encoder: samGraphs.encoderUint8,
    decoder: samGraphs.decoder,
    aisDecoder: samGraphs.aisDecoderInt8Weights,
  },
};

const refusedOnProvider: Readonly<Record<SamProvider, readonly SamGraph[]>> = {
  webgpu: [samGraphs.encoderUint8, samGraphs.aisDecoderUint8],
  wasm: [],
};

export function samVariant(provider: SamProvider): SamVariant {
  return variants[provider];
}

export function graphRunsOn(graph: SamGraph, provider: SamProvider): boolean {
  return !refusedOnProvider[provider].includes(graph);
}

export function samProvider(hasGpuAdapter: boolean): SamProvider {
  return hasGpuAdapter ? "webgpu" : "wasm";
}
