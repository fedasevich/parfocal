import { type SamOutputs, samImageSize, samMaskInputSize } from "./inference-engine.ts";

export const samPixelMean: readonly [number, number, number] = [123.675, 116.28, 103.53];
export const samPixelStd: readonly [number, number, number] = [58.395, 57.12, 57.375];

export interface SamPatchGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly downsample: number;
}

export interface SamFrame {
  readonly patch: SamPatchGeometry;
  readonly scale: number;
  readonly fittedWidth: number;
  readonly fittedHeight: number;
}

export interface SamPlanePoint {
  readonly x: number;
  readonly y: number;
}

export interface BestMask {
  readonly index: number;
  readonly score: number;
  readonly count: number;
  readonly logits: Float32Array;
  readonly lowRes: Float32Array;
}

export function samFrame(patch: SamPatchGeometry): SamFrame {
  const scale = samImageSize / Math.max(patch.width, patch.height);
  return {
    patch,
    scale,
    fittedWidth: Math.max(1, Math.min(samImageSize, Math.floor(patch.width * scale + 0.5))),
    fittedHeight: Math.max(1, Math.min(samImageSize, Math.floor(patch.height * scale + 0.5))),
  };
}

export function slideToModel(frame: SamFrame, point: SamPlanePoint): SamPlanePoint {
  const { patch, scale } = frame;
  return {
    x: (point.x / patch.downsample - patch.x) * scale,
    y: (point.y / patch.downsample - patch.y) * scale,
  };
}

export function modelToSlide(frame: SamFrame, point: SamPlanePoint): SamPlanePoint {
  const { patch, scale } = frame;
  return {
    x: (point.x / scale + patch.x) * patch.downsample,
    y: (point.y / scale + patch.y) * patch.downsample,
  };
}

export function patchContains(patch: SamPatchGeometry, point: SamPlanePoint): boolean {
  const x = point.x / patch.downsample;
  const y = point.y / patch.downsample;
  return x >= patch.x && y >= patch.y && x < patch.x + patch.width && y < patch.y + patch.height;
}

function sourceIndex(target: number, ratio: number, limit: number): [number, number, number] {
  const position = Math.max(0, (target + 0.5) / ratio - 0.5);
  const low = Math.min(limit - 1, Math.floor(position));
  const high = Math.min(limit - 1, low + 1);
  return [low, high, position - low];
}

export function samPixels(rgb: Uint8Array, frame: SamFrame): Float32Array<ArrayBuffer> {
  const { patch, fittedWidth, fittedHeight } = frame;
  const plane = samImageSize * samImageSize;
  const out = new Float32Array(3 * plane);
  const ratioX = fittedWidth / patch.width;
  const ratioY = fittedHeight / patch.height;
  const columns = new Int32Array(fittedWidth * 2);
  const columnWeights = new Float32Array(fittedWidth);
  for (let x = 0; x < fittedWidth; x++) {
    const [low, high, weight] = sourceIndex(x, ratioX, patch.width);
    columns[x * 2] = low;
    columns[x * 2 + 1] = high;
    columnWeights[x] = weight;
  }
  for (let y = 0; y < fittedHeight; y++) {
    const [lowRow, highRow, rowWeight] = sourceIndex(y, ratioY, patch.height);
    for (let x = 0; x < fittedWidth; x++) {
      const lowColumn = columns[x * 2] ?? 0;
      const highColumn = columns[x * 2 + 1] ?? 0;
      const columnWeight = columnWeights[x] ?? 0;
      for (let channel = 0; channel < 3; channel++) {
        const at = (row: number, column: number) =>
          rgb[(row * patch.width + column) * 3 + channel] ?? 0;
        const top =
          at(lowRow, lowColumn) * (1 - columnWeight) + at(lowRow, highColumn) * columnWeight;
        const bottom =
          at(highRow, lowColumn) * (1 - columnWeight) + at(highRow, highColumn) * columnWeight;
        const value = top * (1 - rowWeight) + bottom * rowWeight;
        out[channel * plane + y * samImageSize + x] =
          (value - (samPixelMean[channel] ?? 0)) / (samPixelStd[channel] ?? 1);
      }
    }
  }
  return out;
}

export function bestMask(outputs: SamOutputs): BestMask {
  const { masks, iou_predictions: scores, low_res_masks: lowRes } = outputs;
  if (masks === undefined || scores === undefined || lowRes === undefined) {
    throw new Error("The decoder did not return masks, iou_predictions and low_res_masks");
  }
  const count = scores.data.length;
  let index = 0;
  for (let candidate = 1; candidate < count; candidate++) {
    if ((scores.data[candidate] ?? -Infinity) > (scores.data[index] ?? -Infinity)) {
      index = candidate;
    }
  }
  const size = masks.data.length / count;
  const lowSize = samMaskInputSize * samMaskInputSize;
  return {
    index,
    score: scores.data[index] ?? 0,
    count,
    logits: masks.data.subarray(index * size, (index + 1) * size),
    lowRes: lowRes.data.slice(index * lowSize, (index + 1) * lowSize),
  };
}

export function fittedLogits(logits: Float32Array, frame: SamFrame): Float32Array {
  const side = Math.round(Math.sqrt(logits.length));
  const out = new Float32Array(frame.fittedWidth * frame.fittedHeight);
  for (let y = 0; y < frame.fittedHeight; y++) {
    out.set(logits.subarray(y * side, y * side + frame.fittedWidth), y * frame.fittedWidth);
  }
  return out;
}
