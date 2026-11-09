import {
  modelToSlide,
  type Patch,
  type SamClient,
  type SamFrame,
  type SamOutputs,
  samFrame,
  samImageSize,
  samPixels,
} from "@parfocal/viewer-engine";
import { type AisInstance, aisInstances } from "./ais-instances.ts";
import type { PresetPatchQuery } from "./patch-reader.ts";
import type { PresetPatchPlan, ScalePresetId } from "./scale-presets.ts";
import type { SmartReader } from "./smart-session.ts";

export const regionHaloPixels = 64;

export interface SlideRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SlidePoint {
  readonly x: number;
  readonly y: number;
}

export interface RegionTile {
  readonly centre: SlidePoint;
  readonly core: SlideRect | "patch";
}

export interface PlannedTile extends RegionTile {
  readonly core: SlideRect;
}

export type RegionSam = Pick<SamClient, "encode" | "segmentAll" | "drop">;

export interface RegionNucleus {
  readonly ring: Float32Array;
  readonly centroid: SlidePoint;
  readonly score: number;
}

export interface RegionProgress {
  readonly done: number;
  readonly total: number;
  readonly found: number;
}

export interface RegionPassOptions {
  readonly tiles: readonly RegionTile[];
  readonly preset: ScalePresetId;
  readonly reader: SmartReader;
  readonly sam: RegionSam;
  readonly keep?: (centroid: SlidePoint) => boolean;
  readonly pixels?: (rgb: Uint8Array, frame: SamFrame) => Promise<Float32Array<ArrayBuffer>>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RegionProgress) => void;
  readonly onTile?: (nuclei: readonly RegionNucleus[]) => void;
  readonly outline?: (maps: Float32Array, width: number, height: number) => Promise<AisInstance[]>;
}

export class RegionPassAbortedError extends Error {
  constructor() {
    super("The region pass was stopped");
    this.name = "RegionPassAbortedError";
  }
}

function levelDownsample(plan: PresetPatchPlan): number {
  return plan.level0Pixels / plan.patchPixels;
}

export function planRegionTiles(
  region: SlideRect,
  plan: PresetPatchPlan,
  haloPixels: number = regionHaloPixels,
): PlannedTile[] {
  if (region.width <= 0 || region.height <= 0) return [];
  const halo = Math.min(haloPixels, Math.floor((plan.patchPixels - 1) / 4));
  const step = (plan.patchPixels - halo * 2) * levelDownsample(plan);
  const tiles: PlannedTile[] = [];
  const across = Math.max(1, Math.ceil(region.width / step));
  const down = Math.max(1, Math.ceil(region.height / step));
  for (let row = 0; row < down; row++) {
    for (let column = 0; column < across; column++) {
      const x = region.x + column * step;
      const y = region.y + row * step;
      const core = {
        x,
        y,
        width: Math.min(step, region.x + region.width - x),
        height: Math.min(step, region.y + region.height - y),
      };
      tiles.push({ core, centre: { x: x + core.width / 2, y: y + core.height / 2 } });
    }
  }
  return tiles;
}

export function clickTile(at: SlidePoint): RegionTile {
  return { centre: at, core: "patch" };
}

export function patchBounds(patch: Patch): SlideRect {
  return {
    x: patch.x * patch.downsample,
    y: patch.y * patch.downsample,
    width: patch.width * patch.downsample,
    height: patch.height * patch.downsample,
  };
}

export function ringBounds(ring: Float32Array): SlideRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i] ?? 0;
    const y = ring[i + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function ringContains(ring: Float32Array, point: SlidePoint): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2] ?? 0;
    const yi = ring[i * 2 + 1] ?? 0;
    const xj = ring[j * 2] ?? 0;
    const yj = ring[j * 2 + 1] ?? 0;
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function rectContains(rect: SlideRect, point: SlidePoint): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

function aisMaps(outputs: SamOutputs): { data: Float32Array; size: number } {
  const output = outputs["maps"] ?? Object.values(outputs)[0];
  if (output === undefined) throw new Error("The AIS decoder returned no maps");
  const size = output.dims[output.dims.length - 1] ?? 0;
  if (size <= 0 || output.data.length < size * size * 3) {
    throw new Error("The AIS decoder maps are not three square planes");
  }
  return { data: output.data, size };
}

export function cropMaps(data: Float32Array, size: number, width: number, height: number) {
  if (width === size && height === size) return data;
  const plane = size * size;
  const out = new Float32Array(width * height * 3);
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < height; y++) {
      const from = channel * plane + y * size;
      out.set(data.subarray(from, from + width), channel * width * height + y * width);
    }
  }
  return out;
}

export function instancesToSlide(
  instances: readonly AisInstance[],
  frame: SamFrame,
  mapSize: number,
): RegionNucleus[] {
  const pool = samImageSize / mapSize;
  const toSlide = (x: number, y: number) =>
    modelToSlide(frame, { x: (x + 0.5) * pool, y: (y + 0.5) * pool });
  return instances.map((instance) => {
    const ring = new Float32Array(instance.ring.length);
    for (let i = 0; i < ring.length; i += 2) {
      const point = toSlide(instance.ring[i] ?? 0, instance.ring[i + 1] ?? 0);
      ring[i] = point.x;
      ring[i + 1] = point.y;
    }
    return {
      ring,
      centroid: toSlide(instance.centroid.x, instance.centroid.y),
      score: instance.score,
    };
  });
}

let passCount = 0;

export async function runRegionPass(options: RegionPassOptions): Promise<RegionNucleus[]> {
  const { tiles, reader, sam, preset, signal } = options;
  const pass = ++passCount;
  const found: RegionNucleus[] = [];
  options.onProgress?.({ done: 0, total: tiles.length, found: 0 });
  for (const [index, tile] of tiles.entries()) {
    if (signal?.aborted) throw new RegionPassAbortedError();
    const query: PresetPatchQuery = { preset, x: tile.centre.x, y: tile.centre.y };
    const { patch } = await reader.read(query, signal);
    if (!patch.absent && patch.rgb !== null) {
      const frame = samFrame(patch);
      const id = `region:${pass}:${index}`;
      const pixels =
        options.pixels === undefined
          ? samPixels(patch.rgb, frame)
          : await options.pixels(patch.rgb, frame);
      await sam.encode(id, pixels);
      let outputs: SamOutputs;
      try {
        outputs = await sam.segmentAll(id);
      } finally {
        sam.drop(id);
      }
      const { data, size } = aisMaps(outputs);
      const pool = samImageSize / size;
      const width = Math.min(size, Math.ceil(frame.fittedWidth / pool));
      const height = Math.min(size, Math.ceil(frame.fittedHeight / pool));
      const cropped = cropMaps(data, size, width, height);
      const instances =
        options.outline === undefined
          ? aisInstances(cropped, width, height)
          : await options.outline(cropped, width, height);
      const core = tile.core === "patch" ? patchBounds(patch) : tile.core;
      const kept = instancesToSlide(instances, frame, size).filter(
        (nucleus) =>
          rectContains(core, nucleus.centroid) &&
          (options.keep === undefined || options.keep(nucleus.centroid)),
      );
      found.push(...kept);
      options.onTile?.(kept);
    }
    options.onProgress?.({ done: index + 1, total: tiles.length, found: found.length });
  }
  return found;
}
