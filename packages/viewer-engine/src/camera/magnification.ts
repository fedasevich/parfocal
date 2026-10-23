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
