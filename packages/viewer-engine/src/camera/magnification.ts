export const micronsPerScreenPixelAtOneX = 10;

export function zoomForMagnification(micronsPerPixel: number, magnification: number): number {
  if (!(micronsPerPixel > 0) || !(magnification > 0)) {
    throw new RangeError("Magnification needs a positive pixel size and a positive magnification");
  }
  return Math.log2((micronsPerPixel * magnification) / micronsPerScreenPixelAtOneX);
}

export function magnificationAtZoom(micronsPerPixel: number, zoom: number): number {
  return (micronsPerScreenPixelAtOneX * 2 ** zoom) / micronsPerPixel;
}

export const objectivePresets = [1.25, 2.5, 5, 10, 20, 40] as const;

export type ObjectivePreset = (typeof objectivePresets)[number];

export function nearestObjectivePreset(magnification: number): ObjectivePreset {
  let nearest: ObjectivePreset = objectivePresets[0];
  for (const preset of objectivePresets) {
    if (
      Math.abs(Math.log2(preset / magnification)) < Math.abs(Math.log2(nearest / magnification))
    ) {
      nearest = preset;
    }
  }
  return nearest;
}
