import {
  type Patch,
  patchContains,
  type SamClient,
  samFrame,
  samPixels,
  slideToModel,
} from "@parfocal/viewer-engine";
import type { ScalePresetId } from "../../aiseg/scale-presets.ts";
import type { SmartReader } from "../../aiseg/smart-session.ts";
import type { LearnerCell, PooledFeaturesOf } from "./slide-learner.ts";

export type EmbeddingSam = Pick<SamClient, "encode" | "pool" | "drop">;

export type EmbeddingServices = {
  reader: SmartReader;
  sam: EmbeddingSam;
};

export type EmbeddingFeatureOptions = {
  services: EmbeddingServices;
  preset: ScalePresetId;
  ringOf: (object: string) => Float32Array | undefined;
  maxPatches?: number;
  slideKey?: string;
};

export const defaultMaxPatches = 24;

function centreOf(ring: Float32Array): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const count = Math.max(1, ring.length >> 1);
  for (let at = 0; at + 1 < ring.length; at += 2) {
    x += (ring[at] ?? 0) / count;
    y += (ring[at + 1] ?? 0) / count;
  }
  return { x, y };
}

function insidePatch(patch: Patch, ring: Float32Array): boolean {
  for (let at = 0; at + 1 < ring.length; at += 2) {
    if (!patchContains(patch, { x: ring[at] ?? 0, y: ring[at + 1] ?? 0 })) return false;
  }
  return ring.length >= 6;
}

export function createEmbeddingFeatures(options: EmbeddingFeatureOptions): PooledFeaturesOf {
  const { services, preset, ringOf } = options;
  const limit = options.maxPatches ?? defaultMaxPatches;
  const slideKey = options.slideKey ?? "learner";
  let passes = 0;
  let used = 0;

  return async (cells: readonly LearnerCell[]) => {
    const found = new Map<string, Float32Array>();
    const waiting = cells.flatMap((cell) => {
      const ring = ringOf(cell.object);
      return ring === undefined ? [] : [{ object: cell.object, ring }];
    });
    while (waiting.length > 0 && used < limit) {
      const first = waiting[0];
      if (first === undefined) break;
      used += 1;
      const centre = centreOf(first.ring);
      const { patch } = await services.reader.read({ preset, x: centre.x, y: centre.y });
      const members = waiting.filter((item) => !patch.absent && insidePatch(patch, item.ring));
      if (patch.absent || patch.rgb === null || !members.includes(first)) {
        waiting.shift();
        continue;
      }
      const frame = samFrame(patch);
      const id = `${slideKey}:${passes++}:${patch.key}`;
      try {
        await services.sam.encode(id, samPixels(patch.rgb, frame));
        const outlines = members.map((item) => {
          const ring = new Float32Array(item.ring.length);
          for (let at = 0; at + 1 < ring.length; at += 2) {
            const point = slideToModel(frame, { x: item.ring[at] ?? 0, y: item.ring[at + 1] ?? 0 });
            ring[at] = point.x;
            ring[at + 1] = point.y;
          }
          return ring;
        });
        const features = await services.sam.pool(id, outlines);
        members.forEach((item, index) => {
          const feature = features[index];
          if (feature !== undefined) found.set(item.object, feature);
        });
      } finally {
        services.sam.drop(id);
      }
      for (const item of members) waiting.splice(waiting.indexOf(item), 1);
    }
    return found;
  };
}
