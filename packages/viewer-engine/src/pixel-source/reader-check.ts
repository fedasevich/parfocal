import { nativeAgreementThreshold } from "./tiff/native-jpeg.ts";
import type { PixelArray, PixelResult, PixelSource, PixelWindow } from "./types.ts";

export interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly planes: readonly [Float32Array, Float32Array, Float32Array];
}

export interface ReferenceWindow {
  readonly level: number;
  readonly downsample: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly image: RgbImage;
}

export type ReaderFindingKind =
  | "missing-level"
  | "absent"
  | "unreadable"
  | "colour-space"
  | "channel-order"
  | "offset"
  | "mismatch"
  | "seam";

export interface ReaderFinding {
  readonly kind: ReaderFindingKind;
  readonly level: number;
  readonly detail: string;
  readonly meanError?: number;
  readonly shift?: readonly [number, number];
  readonly ratio?: number;
}

export interface WindowCheck {
  readonly window: ReferenceWindow;
  readonly meanError: number | null;
  readonly finding: ReaderFinding | null;
}

export const READER_AGREEMENT = nativeAgreementThreshold;
export const SHIFT_SEARCH = 8;

export const SEAM_BAND = 8192;
export const SEAM_DEPTH = 96;
export const SEAM_BLOCK = 128;
export const SEAM_TEXTURE_FLOOR = 1.5;
export const SEAM_MIN_BOUNDARIES = 4;
export const SEAM_THRESHOLD = 2.5;

const tissueProbe = 96;

export function rgbImage(width: number, height: number, planes: readonly PixelArray[]): RgbImage {
  const take = (index: number) =>
    Float32Array.from(planes[Math.min(index, planes.length - 1)] ?? []);
  return { width, height, planes: [take(0), take(1), take(2)] };
}

export function rgbFromInterleaved(
  width: number,
  height: number,
  data: ArrayLike<number>,
  stride: number,
): RgbImage {
  const planes = [0, 1, 2].map(() => new Float32Array(width * height));
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      const plane = planes[channel] as Float32Array;
      plane[pixel] = data[pixel * stride + channel] ?? 0;
    }
  }
  return { width, height, planes: planes as unknown as RgbImage["planes"] };
}

function shiftedError(candidate: RgbImage, reference: RgbImage, dx: number, dy: number): number {
  const { width, height } = reference;
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(width, width - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(height, height - dy);
  if (x1 - x0 < width / 2 || y1 - y0 < height / 2) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let channel = 0; channel < 3; channel++) {
    const a = candidate.planes[channel] as Float32Array;
    const b = reference.planes[channel] as Float32Array;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      const shiftedRow = (y + dy) * width + dx;
      for (let x = x0; x < x1; x++) total += Math.abs((a[row + x] ?? 0) - (b[shiftedRow + x] ?? 0));
    }
  }
  return total / (3 * (x1 - x0) * (y1 - y0));
}

export function meanError(candidate: RgbImage, reference: RgbImage): number {
  return shiftedError(candidate, reference, 0, 0);
}

export function ycbcrToRgb(image: RgbImage): RgbImage {
  const [luma, blue, red] = image.planes;
  const size = image.width * image.height;
  const out = [0, 1, 2].map(() => new Float32Array(size)) as unknown as RgbImage["planes"];
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  for (let index = 0; index < size; index++) {
    const y = luma[index] ?? 0;
    const cb = (blue[index] ?? 0) - 128;
    const cr = (red[index] ?? 0) - 128;
    out[0][index] = clamp(y + 1.402 * cr);
    out[1][index] = clamp(y - 0.344136 * cb - 0.714136 * cr);
    out[2][index] = clamp(y + 1.772 * cb);
  }
  return { width: image.width, height: image.height, planes: out };
}

const channelOrders: readonly (readonly [number, number, number])[] = [
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function reordered(image: RgbImage, order: readonly [number, number, number]): RgbImage {
  const planes = order.map((index) => image.planes[index]) as unknown as RgbImage["planes"];
  return { ...image, planes };
}

function shiftCandidates(): [number, number][] {
  const shifts: [number, number][] = [];
  for (let dy = -SHIFT_SEARCH; dy <= SHIFT_SEARCH; dy++)
    for (let dx = -SHIFT_SEARCH; dx <= SHIFT_SEARCH; dx++)
      if (dx !== 0 || dy !== 0) shifts.push([dx, dy]);
  return shifts;
}

export function explainDisagreement(
  candidate: RgbImage,
  window: ReferenceWindow,
  limit = READER_AGREEMENT,
): ReaderFinding | null {
  const reference = window.image;
  const direct = meanError(candidate, reference);
  if (direct <= limit) return null;
  const level = window.level;
  const asColour = meanError(ycbcrToRgb(candidate), reference);
  if (asColour <= limit) {
    return {
      kind: "colour-space",
      level,
      meanError: direct,
      detail: `YCbCr shown as RGB: ${direct.toFixed(1)} apart, ${asColour.toFixed(1)} once converted`,
    };
  }
  for (const order of channelOrders) {
    const error = meanError(reordered(candidate, order), reference);
    if (error <= limit) {
      return {
        kind: "channel-order",
        level,
        meanError: direct,
        detail: `channels in the order ${order.join(",")}: ${direct.toFixed(1)} apart, ${error.toFixed(1)} reordered`,
      };
    }
  }
  let best: { shift: [number, number]; error: number } | null = null;
  for (const shift of shiftCandidates()) {
    const error = shiftedError(candidate, reference, shift[0], shift[1]);
    if (best === null || error < best.error) best = { shift, error };
  }
  if (best !== null && best.error <= limit) {
    return {
      kind: "offset",
      level,
      meanError: direct,
      shift: best.shift,
      detail: `pixels displaced by ${best.shift[0]},${best.shift[1]}: ${direct.toFixed(1)} apart, ${best.error.toFixed(1)} shifted back`,
    };
  }
  return {
    kind: "mismatch",
    level,
    meanError: direct,
    detail: `${direct.toFixed(1)} apart with no colour, channel or offset explanation`,
  };
}

function levelFor(source: PixelSource, downsample: number): number {
  return source.levels.findIndex((level) => Math.abs(level.downsample - downsample) < 0.01);
}

export async function checkWindow(
  source: PixelSource,
  window: ReferenceWindow,
  limit = READER_AGREEMENT,
): Promise<WindowCheck> {
  const level = levelFor(source, window.downsample);
  if (level < 0) {
    const detail = `no level at downsample ${window.downsample}`;
    const finding: ReaderFinding = { kind: "missing-level", level: window.level, detail };
    return { window, meanError: null, finding };
  }
  const bounds: PixelWindow = [
    window.x,
    window.y,
    window.x + window.width,
    window.y + window.height,
  ];
  let result: PixelResult;
  try {
    result = await source.getRaster({ level, window: bounds });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { window, meanError: null, finding: { kind: "unreadable", level, detail } };
  }
  if (result.absent) {
    const detail = "the browser reader returned no pixels";
    return { window, meanError: null, finding: { kind: "absent", level, detail } };
  }
  const candidate = rgbImage(result.width, result.height, result.planes);
  const finding = explainDisagreement(candidate, window, limit);
  return { window, meanError: meanError(candidate, window.image), finding };
}

export async function checkAgainstReference(
  source: PixelSource,
  windows: readonly ReferenceWindow[],
  limit = READER_AGREEMENT,
): Promise<WindowCheck[]> {
  const checks: WindowCheck[] = [];
  for (const window of windows) checks.push(await checkWindow(source, window, limit));
  return checks;
}

function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1] ?? 0;
}

export function columnSteps(image: RgbImage): Float64Array {
  const { width, height, planes } = image;
  const steps = new Float64Array(Math.max(0, width - 1));
  for (let x = 0; x + 1 < width; x++) {
    let total = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (const plane of planes)
        total += Math.abs((plane[row + x] ?? 0) - (plane[row + x + 1] ?? 0));
    }
    steps[x] = total / (height * planes.length);
  }
  return steps;
}

export function rowSteps(image: RgbImage): Float64Array {
  const { width, height, planes } = image;
  const steps = new Float64Array(Math.max(0, height - 1));
  for (let y = 0; y + 1 < height; y++) {
    let total = 0;
    for (let x = 0; x < width; x++) {
      for (const plane of planes)
        total += Math.abs((plane[y * width + x] ?? 0) - (plane[(y + 1) * width + x] ?? 0));
    }
    steps[y] = total / (width * planes.length);
  }
  return steps;
}

function localRatios(steps: Float64Array) {
  const ratios = new Float64Array(steps.length);
  const textured = new Uint8Array(steps.length);
  for (let start = 0; start < steps.length; start += SEAM_BLOCK) {
    const end = Math.min(steps.length, start + SEAM_BLOCK);
    const local = median(steps.subarray(start, end));
    if (local < SEAM_TEXTURE_FLOOR) continue;
    for (let at = start; at < end; at++) {
      ratios[at] = (steps[at] ?? 0) / local;
      textured[at] = 1;
    }
  }
  return { ratios, textured };
}

export interface SeamScore {
  readonly boundaries: number;
  readonly edge: number;
  readonly control: number;
  readonly ratio: number | null;
}

export function seamScore(
  steps: Float64Array,
  origin: number,
  edges: readonly number[],
): SeamScore {
  const { ratios, textured } = localRatios(steps);
  const onGrid = new Set<number>();
  for (const edge of edges) {
    const at = edge - origin - 1;
    if (at >= 0 && at < steps.length && textured[at]) onGrid.add(at);
  }
  const spacing = Math.max(2, Math.round(steps.length / Math.max(1, onGrid.size)));
  const edgeRatios: number[] = [];
  const control: number[] = [];
  for (const at of onGrid) {
    edgeRatios.push(ratios[at] ?? 0);
    const off = at + Math.round(spacing / 3);
    if (off < steps.length && textured[off] && !onGrid.has(off)) control.push(ratios[off] ?? 0);
  }
  const edge = median(edgeRatios);
  const controlRatio = median(control);
  const enough = edgeRatios.length >= SEAM_MIN_BOUNDARIES;
  const ratio = enough ? (controlRatio > 0 ? edge / controlRatio : edge) : null;
  return { boundaries: edgeRatios.length, edge, control: controlRatio, ratio };
}

export function gridEdges(pitch: number, extent: number): number[] {
  const edges: number[] = [];
  for (let at = pitch; at < extent; at += pitch) edges.push(at);
  return edges;
}

async function readRgb(source: PixelSource, level: number, bounds: PixelWindow) {
  const result = await source.getRaster({ level, window: bounds });
  if (result.absent) return null;
  return rgbImage(result.width, result.height, result.planes);
}

function texture(image: RgbImage): number {
  const plane = image.planes[0];
  let total = 0;
  let count = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x + 1 < image.width; x++) {
      const at = y * image.width + x;
      total += Math.abs((plane[at] ?? 0) - (plane[at + 1] ?? 0));
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

export async function findTexturedSpot(
  source: PixelSource,
  level: number,
): Promise<{ x: number; y: number; texture: number }> {
  const { width, height } = source.levels[level] ?? { width: 0, height: 0 };
  let best = { x: 0, y: 0, texture: -1 };
  for (let fy = 0.2; fy <= 0.81; fy += 0.2) {
    for (let fx = 0.15; fx <= 0.86; fx += 0.175) {
      const x = Math.min(Math.round(width * fx), Math.max(0, width - tissueProbe));
      const y = Math.min(Math.round(height * fy), Math.max(0, height - tissueProbe));
      const bounds: PixelWindow = [
        x,
        y,
        Math.min(width, x + tissueProbe),
        Math.min(height, y + tissueProbe),
      ];
      const probe = await readRgb(source, level, bounds);
      const score = probe === null ? 0 : texture(probe);
      if (score > best.texture) best = { x, y, texture: score };
    }
  }
  return best;
}

function bandStart(centre: number, span: number, extent: number): number {
  return Math.max(0, Math.min(extent - span, Math.round(centre - span / 2)));
}

export interface SeamCheck {
  readonly level: number;
  readonly origin: readonly [number, number];
  readonly vertical: SeamScore;
  readonly horizontal: SeamScore;
  readonly finding: ReaderFinding | null;
}

export async function checkSeams(source: PixelSource, level = 0): Promise<SeamCheck> {
  const pyramidLevel = source.levels[level];
  if (pyramidLevel === undefined) throw new Error(`no level ${level}`);
  const { width, height, tileWidth, tileHeight } = pyramidLevel;
  const spanX = Math.min(SEAM_BAND, width);
  const spanY = Math.min(SEAM_BAND, height);
  const spot = await findTexturedSpot(source, level);
  const depthY = Math.min(SEAM_DEPTH, height);
  const depthX = Math.min(SEAM_DEPTH, width);
  const acrossX = bandStart(spot.x, spanX, width);
  const downY = bandStart(spot.y, spanY, height);
  const across = await readRgb(source, level, [acrossX, spot.y, acrossX + spanX, spot.y + depthY]);
  const down = await readRgb(source, level, [spot.x, downY, spot.x + depthX, downY + spanY]);
  const empty: SeamScore = { boundaries: 0, edge: 0, control: 0, ratio: null };
  const vertical = across
    ? seamScore(columnSteps(across), acrossX, gridEdges(tileWidth, width))
    : empty;
  const horizontal = down ? seamScore(rowSteps(down), downY, gridEdges(tileHeight, height)) : empty;
  const worst = Math.max(vertical.ratio ?? 0, horizontal.ratio ?? 0);
  const finding: ReaderFinding | null =
    worst >= SEAM_THRESHOLD
      ? {
          kind: "seam",
          level,
          ratio: worst,
          detail: `tile edges step ${worst.toFixed(2)}x more than the tissue beside them`,
        }
      : null;
  return { level, origin: [acrossX, downY], vertical, horizontal, finding };
}
