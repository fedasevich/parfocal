export const minSlideBrightness = 20;
export const maxSlideBrightness = 140;
export const defaultSlideBrightness = 100;

export function clampSlideBrightness(percent: number): number {
  if (!Number.isFinite(percent)) return defaultSlideBrightness;
  return Math.min(maxSlideBrightness, Math.max(minSlideBrightness, Math.round(percent)));
}

export function slideBrightnessFactor(percent: number): number {
  return clampSlideBrightness(percent) / 100;
}

export function slideTint(factor: number): [number, number, number] {
  const channel = 255 * factor;
  return [channel, channel, channel];
}
