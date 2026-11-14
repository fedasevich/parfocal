import type { SamOutput, SamOutputs, SamPrompt } from "./inference-engine.ts";

export const samEmbeddingSide = 64;
export const samTokenPixels = 16;
export const samMaskTokenPixels = 4;
export const samWindowTokens = 32;
export const samWindowMargin = 4;
export const outsideWindowLogit = -20;

export interface EmbeddingWindow {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export interface WindowOptions {
  readonly size?: number;
  readonly margin?: number;
}

function promptCorners(prompt: SamPrompt): { xs: number[]; ys: number[] } {
  const xs = prompt.points.map((point) => point.x);
  const ys = prompt.points.map((point) => point.y);
  if (prompt.box) {
    xs.push(prompt.box.x0, prompt.box.x1);
    ys.push(prompt.box.y0, prompt.box.y1);
  }
  return { xs, ys };
}

function axisOrigin(low: number, high: number, size: number): number {
  const centre = (low + high) / 2 / samTokenPixels;
  const origin = Math.floor(centre - size / 2 + 0.5);
  return Math.min(samEmbeddingSide - size, Math.max(0, origin));
}

function fitsAxis(low: number, high: number, origin: number, size: number, margin: number) {
  const first = low / samTokenPixels;
  const last = high / samTokenPixels;
  const lowMargin = origin === 0 ? 0 : margin;
  const highMargin = origin + size === samEmbeddingSide ? 0 : margin;
  return first >= origin + lowMargin && last <= origin + size - highMargin;
}

function logitsInside(logits: Float32Array, window: EmbeddingWindow): boolean {
  const side = Math.round(Math.sqrt(logits.length));
  const scale = side / samEmbeddingSide;
  const x0 = window.x * scale;
  const y0 = window.y * scale;
  const x1 = x0 + window.size * scale;
  const y1 = y0 + window.size * scale;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (!inside && (logits[y * side + x] ?? 0) > 0) {
        return false;
      }
    }
  }
  return true;
}

export function embeddingWindow(
  prompt: SamPrompt,
  options: WindowOptions = {},
): EmbeddingWindow | null {
  const size = options.size ?? samWindowTokens;
  const margin = options.margin ?? samWindowMargin;
  if (size >= samEmbeddingSide) {
    return null;
  }
  const { xs, ys } = promptCorners(prompt);
  if (xs.length === 0) {
    return null;
  }
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const window = {
    x: axisOrigin(left, right, size),
    y: axisOrigin(top, bottom, size),
    size,
  };
  if (
    !fitsAxis(left, right, window.x, size, margin) ||
    !fitsAxis(top, bottom, window.y, size, margin)
  ) {
    return null;
  }
  if (prompt.previousLogits && !logitsInside(prompt.previousLogits, window)) {
    return null;
  }
  return window;
}

function bestIndex(scores: Float32Array): number {
  let index = 0;
  for (let candidate = 1; candidate < scores.length; candidate++) {
    if ((scores[candidate] ?? -Infinity) > (scores[index] ?? -Infinity)) {
      index = candidate;
    }
  }
  return index;
}

function planeSide(output: SamOutput): number {
  return output.dims[output.dims.length - 1] ?? 0;
}

export function touchesInnerEdge(outputs: SamOutputs, window: EmbeddingWindow): boolean {
  const lowRes = outputs["low_res_masks"];
  const scores = outputs["iou_predictions"];
  if (lowRes === undefined || scores === undefined) {
    return true;
  }
  const side = planeSide(lowRes);
  const plane = side * side;
  const best = bestIndex(scores.data);
  const mask = lowRes.data.subarray(best * plane, (best + 1) * plane);
  const last = side - 1;
  const limit = samEmbeddingSide - window.size;
  const on = (x: number, y: number) => (mask[y * side + x] ?? 0) > 0;
  for (let step = 0; step < side; step++) {
    if (window.y > 0 && on(step, 0)) return true;
    if (window.y < limit && on(step, last)) return true;
    if (window.x > 0 && on(0, step)) return true;
    if (window.x < limit && on(last, step)) return true;
  }
  return false;
}

function pastePlanes(
  output: SamOutput,
  window: EmbeddingWindow,
  pixelsPerToken: number,
): SamOutput {
  const side = planeSide(output);
  const plane = side * side;
  const fullSide = samEmbeddingSide * pixelsPerToken;
  const fullPlane = fullSide * fullSide;
  const count = plane === 0 ? 0 : output.data.length / plane;
  const data = new Float32Array(count * fullPlane).fill(outsideWindowLogit);
  const x0 = window.x * pixelsPerToken;
  const y0 = window.y * pixelsPerToken;
  for (let mask = 0; mask < count; mask++) {
    for (let row = 0; row < side; row++) {
      const from = mask * plane + row * side;
      data.set(
        output.data.subarray(from, from + side),
        mask * fullPlane + (y0 + row) * fullSide + x0,
      );
    }
  }
  return { dims: [...output.dims.slice(0, -2), fullSide, fullSide], data };
}

export function pasteWindowOutputs(outputs: SamOutputs, window: EmbeddingWindow): SamOutputs {
  const pasted: Record<string, SamOutput> = { ...outputs };
  const masks = outputs["masks"];
  const lowRes = outputs["low_res_masks"];
  if (masks !== undefined) {
    pasted["masks"] = pastePlanes(masks, window, samTokenPixels);
  }
  if (lowRes !== undefined) {
    pasted["low_res_masks"] = pastePlanes(lowRes, window, samMaskTokenPixels);
  }
  return pasted;
}
