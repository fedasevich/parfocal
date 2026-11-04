export type ScalePresetId = "nuclei" | "cells" | "tissue" | "region";

export interface ScalePreset {
  readonly id: ScalePresetId;
  readonly micronsPerPixel: number;
  readonly fallbackDownsample: number;
}

export const SCALE_PRESETS: Readonly<Record<ScalePresetId, ScalePreset>> = {
  nuclei: { id: "nuclei", micronsPerPixel: 0.25, fallbackDownsample: 1 },
  cells: { id: "cells", micronsPerPixel: 0.5, fallbackDownsample: 2 },
  tissue: { id: "tissue", micronsPerPixel: 2, fallbackDownsample: 8 },
  region: { id: "region", micronsPerPixel: 8, fallbackDownsample: 32 },
};

export const SCALE_PRESET_IDS: readonly ScalePresetId[] = ["nuclei", "cells", "tissue", "region"];

export const PATCH_WIDTH_MICRONS = 128;

export interface PresetLevel {
  readonly downsample: number;
}

export interface PresetMicronsPerPixel {
  readonly x: number;
  readonly y: number;
}

export interface PresetPatchPlan {
  readonly preset: ScalePresetId;
  readonly level: number;
  readonly levelMicronsPerPixel: number | null;
  readonly sizedByMicrons: boolean;
  readonly patchPixels: number;
  readonly level0Pixels: number;
}

function isPositive(value: number | null | undefined): value is number {
  return value !== undefined && value !== null && Number.isFinite(value) && value > 0;
}

function nearestOnLogScale(ratios: readonly number[]): number {
  let best = 0;
  let bestError = Infinity;
  ratios.forEach((ratio, index) => {
    const error = Math.abs(Math.log(ratio));
    if (error < bestError) {
      best = index;
      bestError = error;
    }
  });
  return best;
}

export function levelMicronsPerPixel(
  base: PresetMicronsPerPixel | null | undefined,
  level: PresetLevel,
): number | null {
  const x = base?.x;
  return isPositive(x) ? x * level.downsample : null;
}

export function selectPresetLevel(
  levels: readonly PresetLevel[],
  base: PresetMicronsPerPixel | null | undefined,
  preset: ScalePresetId,
): number {
  if (levels.length === 0) throw new RangeError("A slide needs at least one level");
  const wanted = SCALE_PRESETS[preset];
  const x = base?.x;
  if (isPositive(x)) {
    return nearestOnLogScale(
      levels.map((level) => (x * level.downsample) / wanted.micronsPerPixel),
    );
  }
  return nearestOnLogScale(levels.map((level) => level.downsample / wanted.fallbackDownsample));
}

export function planPresetPatch(
  levels: readonly PresetLevel[],
  base: PresetMicronsPerPixel | null | undefined,
  preset: ScalePresetId,
): PresetPatchPlan {
  const level = selectPresetLevel(levels, base, preset);
  const chosen = levels[level] as PresetLevel;
  const { downsample } = chosen;
  const micronsPerPixel = levelMicronsPerPixel(base, chosen);
  const patchPixels = Math.max(
    1,
    Math.round(PATCH_WIDTH_MICRONS / (micronsPerPixel ?? SCALE_PRESETS[preset].micronsPerPixel)),
  );
  return {
    preset,
    level,
    levelMicronsPerPixel: micronsPerPixel,
    sizedByMicrons: micronsPerPixel !== null,
    patchPixels,
    level0Pixels: Math.round(patchPixels * downsample),
  };
}
