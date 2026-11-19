import { useSyncExternalStore } from "react";
import { type DeviceStorage, readDeviceSettings, writeDeviceSetting } from "./device-settings.ts";

export const confidenceForms = ["number", "word", "color", "hidden"] as const;
export const colormapChoices = ["viridis", "inferno", "turbo"] as const;
export const textSizes = ["small", "normal", "large"] as const;
export const classPalettes = ["standard", "safe"] as const;

export type ConfidenceForm = (typeof confidenceForms)[number];
export type ColormapChoice = (typeof colormapChoices)[number];
export type TextSize = (typeof textSizes)[number];
export type ClassPalette = (typeof classPalettes)[number];

export type DisplayDefaults = {
  fillOpacity: number;
  heatmapOpacity: number;
  confidence: ConfidenceForm;
  colormap: ColormapChoice;
  textSize: TextSize;
  classPalette: ClassPalette;
};

export const fillOpacityRange = { min: 20, max: 100, step: 10 } as const;
export const heatmapOpacityRange = { min: 20, max: 100, step: 10 } as const;

export const textScales: Readonly<Record<TextSize, number>> = {
  small: 0.9,
  normal: 1,
  large: 1.15,
};

export const defaultDisplayDefaults: DisplayDefaults = {
  fillOpacity: 100,
  heatmapOpacity: 70,
  confidence: "number",
  colormap: "viridis",
  textSize: "normal",
  classPalette: "standard",
};

const keyOf = (key: keyof DisplayDefaults) => `display.${key}`;

const pick = <T extends string>(choices: readonly T[], stored: unknown, fallback: T): T =>
  choices.find((choice) => choice === stored) ?? fallback;

const stepped = (
  stored: unknown,
  range: { min: number; max: number; step: number },
  fallback: number,
) => {
  if (typeof stored !== "number" || Number.isNaN(stored)) return fallback;
  const snapped = Math.round(stored / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
};

export function readDisplayDefaults(storage?: DeviceStorage): DisplayDefaults {
  const stored = storage === undefined ? readDeviceSettings() : readDeviceSettings(storage);
  const base = defaultDisplayDefaults;
  return {
    fillOpacity: stepped(stored[keyOf("fillOpacity")], fillOpacityRange, base.fillOpacity),
    heatmapOpacity: stepped(
      stored[keyOf("heatmapOpacity")],
      heatmapOpacityRange,
      base.heatmapOpacity,
    ),
    confidence: pick(confidenceForms, stored[keyOf("confidence")], base.confidence),
    colormap: pick(colormapChoices, stored[keyOf("colormap")], base.colormap),
    textSize: pick(textSizes, stored[keyOf("textSize")], base.textSize),
    classPalette: pick(classPalettes, stored[keyOf("classPalette")], base.classPalette),
  };
}

export function applyTextSize(size: TextSize, root: HTMLElement = document.documentElement) {
  const scale = textScales[size];
  root.style.fontSize = `${scale * 100}%`;
  root.style.setProperty("--text-scale", String(scale));
}

let current: DisplayDefaults | null = null;
const listeners = new Set<() => void>();

const snapshot = (): DisplayDefaults => {
  current ??= readDisplayDefaults();
  return current;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function displayDefaultsNow(): DisplayDefaults {
  return snapshot();
}

export function chooseDisplayDefault<K extends keyof DisplayDefaults>(
  key: K,
  value: DisplayDefaults[K],
): void {
  writeDeviceSetting(keyOf(key), value);
  current = { ...snapshot(), [key]: value };
  if (key === "textSize") applyTextSize(current.textSize);
  for (const listener of listeners) listener();
}

export function useDisplayDefaults(): DisplayDefaults {
  return useSyncExternalStore(subscribe, snapshot, () => defaultDisplayDefaults);
}

export function installDisplayDefaults(): void {
  applyTextSize(snapshot().textSize);
}

export function personalPanelValues(defaults: DisplayDefaults = snapshot()): {
  opacity?: number;
  confidence?: string;
} {
  return {
    ...(defaults.fillOpacity === defaultDisplayDefaults.fillOpacity
      ? {}
      : { opacity: defaults.fillOpacity }),
    ...(defaults.confidence === defaultDisplayDefaults.confidence
      ? {}
      : { confidence: defaults.confidence }),
  };
}
