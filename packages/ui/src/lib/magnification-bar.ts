export const magnificationPresets = [1.25, 2.5, 5, 10, 20, 40] as const;

export type MagnificationPreset = (typeof magnificationPresets)[number];

export type MagnificationLabel = "objective" | "zoom-percent";

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
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

export type BarState = { open: boolean; brightnessChanged: boolean };

export type BarRect = [x: number, y: number, width: number, height: number];

const openWidth = 660;
const openHeight = 54;
const openFromBottom = 62;
const foldedWidth = 230;
const foldedWidthWithBrightness = 300;
const foldedHeight = 50;
const foldedFromBottom = 60;

export function magnificationBarRect(
  canvas: { width: number; height: number },
  { open, brightnessChanged }: BarState,
): BarRect {
  if (open)
    return [
      canvas.width / 2 - openWidth / 2,
      canvas.height - openFromBottom,
      openWidth,
      openHeight,
    ];
  const width = brightnessChanged ? foldedWidthWithBrightness : foldedWidth;
  return [canvas.width / 2 - width / 2, canvas.height - foldedFromBottom, width, foldedHeight];
}
