import type { DenseLayer, InstanSegPostProcess } from "./labels.ts";

export {
  type InstanSegInput,
  instansegInput,
  modelMicronsPerPixel,
  networkInput,
  type RgbTile,
  resizeRgb,
  stretchChannels,
} from "./input.ts";
export {
  type DenseLayer,
  type InstanSegLabels,
  type InstanSegMaps,
  type InstanSegPostProcess,
  instansegLabels,
} from "./labels.ts";

export const instansegPostProcessFile = "instanseg-postprocess.json";

interface LayerJson {
  weights: number[][];
  bias: number[];
}

interface PostProcessJson {
  classifier: LayerJson[];
  maskThreshold: number;
  peakDistance: number;
  seedThreshold: number;
  overlapThreshold: number;
  windowSize: number;
}

function denseLayer(layer: LayerJson): DenseLayer {
  const outputs = layer.weights.length;
  const inputs = layer.weights[0]?.length ?? 0;
  if (layer.bias.length !== outputs || layer.weights.some((row) => row.length !== inputs)) {
    throw new Error("InstanSeg classifier layer has inconsistent shapes");
  }
  return {
    inputs,
    outputs,
    weights: Float32Array.from(layer.weights.flat()),
    bias: Float32Array.from(layer.bias),
  };
}

export function parsePostProcess(json: unknown): InstanSegPostProcess {
  const value = json as PostProcessJson;
  if (!Array.isArray(value.classifier) || value.classifier.length === 0) {
    throw new Error("InstanSeg post-processing has no classifier");
  }
  return {
    classifier: value.classifier.map(denseLayer),
    maskThreshold: value.maskThreshold,
    peakDistance: value.peakDistance,
    seedThreshold: value.seedThreshold,
    overlapThreshold: value.overlapThreshold,
    windowSize: value.windowSize,
  };
}
