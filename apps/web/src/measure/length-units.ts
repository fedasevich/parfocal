import { useSyncExternalStore } from "react";

export type LengthUnits = "auto" | "um";

const storageKey = "parfocal.length-units";

const listeners = new Set<() => void>();

let current: LengthUnits | null = null;

function stored(): LengthUnits {
  try {
    return window.localStorage.getItem(storageKey) === "um" ? "um" : "auto";
  } catch {
    return "auto";
  }
}

export function lengthUnitsNow(): LengthUnits {
  current ??= stored();
  return current;
}

export function setLengthUnits(next: LengthUnits): void {
  current = next;
  try {
    window.localStorage.setItem(storageKey, next);
  } catch {
    current = next;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLengthUnits(): LengthUnits {
  return useSyncExternalStore(subscribe, lengthUnitsNow, () => "auto");
}

function grouped(value: number): string {
  const whole = String(Math.round(value));
  if (whole.length < 5) return whole;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatMicrons(microns: number, units: LengthUnits = lengthUnitsNow()): string {
  const tenths = Math.round(microns * 10) / 10;
  if (tenths < 100) return `${tenths.toFixed(1)} µm`;
  if (microns < 999.5 || units === "um") return `${grouped(microns)} µm`;
  return `${(microns / 1000).toFixed(2)} mm`;
}

export function formatMillimetres(
  millimetres: number,
  digits = 1,
  units: LengthUnits = lengthUnitsNow(),
): string {
  if (units === "um") return formatMicrons(millimetres * 1000, "um");
  return `${millimetres.toFixed(digits)} mm`;
}

export function lengthUnitsFromSetting(value: string | undefined): LengthUnits {
  return value === "um" ? "um" : "auto";
}

export function applySavedLengthUnits(value: string | undefined): void {
  if (value !== undefined) setLengthUnits(lengthUnitsFromSetting(value));
}

export function formatSquareMicrons(
  microns: number,
  units: LengthUnits = lengthUnitsNow(),
): string {
  if (microns < 100) return `${microns.toFixed(1)} µm²`;
  if (microns < 999_500 || units === "um") return `${grouped(microns)} µm²`;
  return `${(microns / 1_000_000).toFixed(2)} mm²`;
}
