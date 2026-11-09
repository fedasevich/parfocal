import { useSyncExternalStore } from "react";

export const labRenderers = ["viv", "webgpu", "deck"] as const;
export const labCullModes = ["gpu", "cpu", "none"] as const;
export const labInterpolations = ["auto", "linear", "nearest"] as const;
export const labDetailLevels = ["off", "fade", "dots", "density", "tiered"] as const;
export const labNucleiCounts = ["off", "10k", "100k", "500k", "1M"] as const;

export const labHudCorners = ["tl", "tr", "bl"] as const;

export type LabSettings = {
  renderer: (typeof labRenderers)[number];
  culling: (typeof labCullModes)[number];
  interpolation: (typeof labInterpolations)[number];
  prefetch: boolean;
  motionVector: boolean;
  detailLevel: (typeof labDetailLevels)[number];
  nuclei: (typeof labNucleiCounts)[number];
  hud: boolean;
  hudCorner: (typeof labHudCorners)[number];
  pauseModels: boolean;
};

export const labDefaults: LabSettings = {
  renderer: "viv",
  culling: "gpu",
  interpolation: "auto",
  prefetch: true,
  motionVector: false,
  detailLevel: "tiered",
  nuclei: "100k",
  hud: true,
  hudCorner: "tl",
  pauseModels: true,
};

const storageKey = "parfocal-lab-settings";

const listeners = new Set<() => void>();

let current: LabSettings | null = null;

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export function parseLabSettings(text: string | null): LabSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  return {
    renderer: oneOf(labRenderers, raw["renderer"], labDefaults.renderer),
    culling: oneOf(labCullModes, raw["culling"], labDefaults.culling),
    interpolation: oneOf(labInterpolations, raw["interpolation"], labDefaults.interpolation),
    prefetch: flag(raw["prefetch"], labDefaults.prefetch),
    motionVector: flag(raw["motionVector"], labDefaults.motionVector),
    detailLevel: oneOf(labDetailLevels, raw["detailLevel"], labDefaults.detailLevel),
    nuclei: oneOf(labNucleiCounts, raw["nuclei"], labDefaults.nuclei),
    hud: flag(raw["hud"], labDefaults.hud),
    hudCorner: oneOf(labHudCorners, raw["hudCorner"], labDefaults.hudCorner),
    pauseModels: flag(raw["pauseModels"], labDefaults.pauseModels),
  };
}

function stored(): LabSettings {
  try {
    return parseLabSettings(window.localStorage.getItem(storageKey));
  } catch {
    return labDefaults;
  }
}

export function readLabSettings(): LabSettings {
  current ??= stored();
  return current;
}

function publish(next: LabSettings): void {
  current = next;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    current = next;
  }
  for (const notify of listeners) notify();
}

export function setLabSetting<K extends keyof LabSettings>(key: K, value: LabSettings[K]): void {
  publish({ ...readLabSettings(), [key]: value });
}

export function resetLabSettings(): void {
  publish(labDefaults);
}

export function subscribeLabSettings(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useLabSettings(): LabSettings {
  return useSyncExternalStore(subscribeLabSettings, readLabSettings, () => labDefaults);
}

export type VivRouteSwitches = { interpolation?: "linear"; prefetch: boolean };

export function vivSwitchesOf(settings: LabSettings): VivRouteSwitches {
  return {
    prefetch: settings.prefetch,
    ...(settings.interpolation === "linear" ? { interpolation: "linear" as const } : {}),
  };
}

const nucleiCounts: Record<LabSettings["nuclei"], number> = {
  off: 0,
  "10k": 10_000,
  "100k": 100_000,
  "500k": 500_000,
  "1M": 1_000_000,
};

export const nucleiCountOf = (settings: LabSettings): number => nucleiCounts[settings.nuclei];

export const hudShown = (settings: LabSettings): boolean => settings.hud;

export const modelsPausedWhileMoving = (settings: LabSettings): boolean => settings.pauseModels;
