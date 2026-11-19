export const magnificationPresets = [1.25, 2.5, 5, 10, 20, 40] as const;

export type MagnificationPreset = (typeof magnificationPresets)[number];

export type MagnificationLabel = "objective" | "zoom-percent" | "microns-per-pixel";

export const zoomHoldMs = 2000;

export const fullObjective = 40;

export type BarSignals = {
  hover: boolean;
  focus: boolean;
  altHeld: boolean;
  brightnessOpen: boolean;
  zoomedAt: number | null;
};

export const calmBar: BarSignals = {
  hover: false,
  focus: false,
  altHeld: false,
  brightnessOpen: false,
  zoomedAt: null,
};

export function nearestMagnificationPreset(magnification: number): MagnificationPreset {
  return magnificationPresets.reduce((best, preset) =>
    Math.abs(Math.log(preset / magnification)) < Math.abs(Math.log(best / magnification))
      ? preset
      : best,
  );
}

export function presetForDigit(digit: number): MagnificationPreset | null {
  return magnificationPresets[digit - 1] ?? null;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (value >= 10) return value.toFixed(0);
  return value >= 2 ? value.toFixed(1) : String(Number(value.toFixed(2)));
}

export function formatReadout(
  magnification: number,
  digital: boolean,
  micronsPerPixel: number,
): string {
  const objective = formatMagnification(magnification, "objective");
  return `${objective}${digital ? " digital" : ""} · ${micronsPerPixel.toFixed(2)} µm/px`;
}

export function formatMagnification(
  value: number,
  label: MagnificationLabel = "objective",
): string {
  return label === "zoom-percent"
    ? `${Math.round((value / fullObjective) * 100)}%`
    : `${formatNumber(value)}×`;
}

export function zoomHoldActive(zoomedAt: number | null, now: number): boolean {
  return zoomedAt !== null && now - zoomedAt >= 0 && now - zoomedAt < zoomHoldMs;
}

export function isBarOpen(signals: BarSignals, now: number): boolean {
  return (
    signals.hover ||
    signals.focus ||
    signals.altHeld ||
    signals.brightnessOpen ||
    zoomHoldActive(signals.zoomedAt, now)
  );
}

export function msUntilFold(signals: BarSignals, now: number): number | null {
  if (signals.zoomedAt === null || !zoomHoldActive(signals.zoomedAt, now)) return null;
  return signals.zoomedAt + zoomHoldMs - now;
}

export type BarState = {
  open: boolean;
  brightnessChanged: boolean;
  docked?: boolean;
};

export type BarRect = [x: number, y: number, width: number, height: number];

const openWidth = 660;
const openHeight = 54;
const openFromBottom = 62;
const foldedWidth = 230;
const foldedWidthWithBrightness = 300;
const foldedHeight = 50;
const foldedFromBottom = 60;
const dockedInset = 12;

export function magnificationBarRect(
  canvas: { width: number; height: number },
  { open, brightnessChanged, docked = false }: BarState,
): BarRect {
  const width = open ? openWidth : brightnessChanged ? foldedWidthWithBrightness : foldedWidth;
  const height = open ? openHeight : foldedHeight;
  if (docked) return [canvas.width - dockedInset - width, dockedInset, width, height];
  if (open) {
    return [canvas.width / 2 - width / 2, canvas.height - openFromBottom, width, height];
  }
  return [canvas.width / 2 - width / 2, canvas.height - foldedFromBottom, width, height];
}
