import type { Patch, PatchCacheStats, PatchRead, PatchReader } from "@parfocal/viewer-engine";
import {
  type PresetPatchPlan,
  planPresetPatch,
  SCALE_PRESET_IDS,
  type ScalePresetId,
} from "./scale-presets.ts";

export interface PresetPatchQuery {
  readonly preset: ScalePresetId;
  readonly x: number;
  readonly y: number;
}

export interface PresetPatch {
  readonly preset: ScalePresetId;
  readonly plan: PresetPatchPlan;
  readonly patch: Patch;
  readonly cacheHit: boolean;
  readonly moved: boolean;
  readonly widthMicrons: number | null;
}

export interface PresetPatchReader {
  readonly ready: Promise<PresetPatchPlan[]>;
  plan(preset: ScalePresetId): Promise<PresetPatchPlan>;
  read(query: PresetPatchQuery, signal?: AbortSignal): Promise<PresetPatch>;
  stats(): PatchCacheStats;
  close(): void;
}

export function patchWidthMicrons(read: PatchRead, plan: PresetPatchPlan): number | null {
  return plan.levelMicronsPerPixel === null ? null : read.patch.width * plan.levelMicronsPerPixel;
}

export function createPresetPatchReader(inner: PatchReader): PresetPatchReader {
  const planFor = async (preset: ScalePresetId): Promise<PresetPatchPlan> => {
    const info = await inner.ready;
    return planPresetPatch(info.levels, info.micronsPerPixel, preset);
  };
  return {
    ready: inner.ready.then((info) =>
      SCALE_PRESET_IDS.map((preset) => planPresetPatch(info.levels, info.micronsPerPixel, preset)),
    ),
    plan: planFor,
    async read(query, signal) {
      const plan = await planFor(query.preset);
      const read = await inner.read(
        { level: plan.level, size: plan.patchPixels, x: query.x, y: query.y },
        signal,
      );
      return {
        preset: query.preset,
        plan,
        patch: read.patch,
        cacheHit: read.cacheHit,
        moved: read.moved,
        widthMicrons: patchWidthMicrons(read, plan),
      };
    },
    stats: () => inner.stats(),
    close: () => inner.close(),
  };
}
