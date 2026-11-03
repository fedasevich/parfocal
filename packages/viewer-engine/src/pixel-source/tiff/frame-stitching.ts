import type { PixelArray, PixelWindow, SlideStitching } from "../types.ts";

export interface FrameAxis {
  readonly starts: readonly number[];
  readonly frame: number;
}

export interface FrameLayout {
  readonly across: FrameAxis;
  readonly down: FrameAxis;
}

export interface AxisSamples {
  readonly rawStart: number;
  readonly rawEnd: number;
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly weight: Float64Array;
}

export function evenStarts(count: number, advance: number): number[] {
  return Array.from({ length: count }, (_, index) => index * advance);
}

function advanceOf(
  given: number | undefined,
  extent: number,
  frame: number,
  count: number,
): number {
  if (given !== undefined) return given;
  return count > 1 ? (extent - frame) / (count - 1) : frame;
}

export function frameLayout(
  stitching: SlideStitching,
  baseWidth: number,
  baseHeight: number,
): FrameLayout {
  const { columns, rows, frameWidth, frameHeight } = stitching;
  return {
    across: {
      starts: evenStarts(columns, advanceOf(stitching.advanceX, baseWidth, frameWidth, columns)),
      frame: frameWidth,
    },
    down: {
      starts: evenStarts(rows, advanceOf(stitching.advanceY, baseHeight, frameHeight, rows)),
      frame: frameHeight,
    },
  };
}

function lastStartAtOrBefore(starts: readonly number[], position: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function sampleAxis(
  axis: FrameAxis,
  downsample: number,
  rawLength: number,
  from: number,
  to: number,
): AxisSamples {
  const count = to - from;
  const low = new Int32Array(count);
  const high = new Int32Array(count);
  const weight = new Float64Array(count);
  const rawFrame = axis.frame / downsample;
  for (let at = 0; at < count; at++) {
    const position = (from + at) * downsample;
    const frame = lastStartAtOrBefore(axis.starts, position);
    const offset = Math.min(position - (axis.starts[frame] ?? 0), axis.frame) / downsample;
    const frameFirst = frame * rawFrame;
    const frameLast = Math.min(rawLength - 1, Math.ceil(frameFirst + rawFrame) - 1);
    const raw = Math.min(frameFirst + offset, frameLast);
    const floor = Math.max(0, Math.floor(raw));
    low[at] = floor;
    high[at] = Math.min(floor + 1, frameLast);
    weight[at] = raw - floor;
  }
  const rawStart = count > 0 ? (low[0] ?? 0) : 0;
  const rawEnd = count > 0 ? Math.max(high[count - 1] ?? 0, low[count - 1] ?? 0) + 1 : 0;
  for (let at = 0; at < count; at++) {
    low[at] = (low[at] ?? 0) - rawStart;
    high[at] = (high[at] ?? 0) - rawStart;
  }
  return { rawStart, rawEnd, low, high, weight };
}

export function rawWindow(across: AxisSamples, down: AxisSamples): PixelWindow {
  return [across.rawStart, down.rawStart, across.rawEnd, down.rawEnd];
}

export function resample(
  plane: PixelArray,
  rawWidth: number,
  across: AxisSamples,
  down: AxisSamples,
): PixelArray {
  const width = across.low.length;
  const height = down.low.length;
  const Plane = plane.constructor as new (length: number) => PixelArray;
  const out = new Plane(width * height);
  const rounded =
    plane instanceof Float32Array || plane instanceof Float64Array ? null : Math.round;
  for (let y = 0; y < height; y++) {
    const top = (down.low[y] ?? 0) * rawWidth;
    const bottom = (down.high[y] ?? 0) * rawWidth;
    const fy = down.weight[y] ?? 0;
    for (let x = 0; x < width; x++) {
      const left = across.low[x] ?? 0;
      const right = across.high[x] ?? 0;
      const fx = across.weight[x] ?? 0;
      const upper = Number(plane[top + left]) * (1 - fx) + Number(plane[top + right]) * fx;
      const lower = Number(plane[bottom + left]) * (1 - fx) + Number(plane[bottom + right]) * fx;
      const value = upper * (1 - fy) + lower * fy;
      out[y * width + x] = rounded === null ? value : rounded(value);
    }
  }
  return out;
}
