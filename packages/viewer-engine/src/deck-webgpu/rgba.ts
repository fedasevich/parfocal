const opaque = 255;

export function rgbToRgba(rgb: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const pixels = width * height;
  if (rgb.length !== pixels * 3) {
    throw new RangeError(
      `An RGB tile of ${width} by ${height} needs ${pixels * 3} bytes, got ${rgb.length}`,
    );
  }
  const rgba = new Uint8Array(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const from = pixel * 3;
    const to = pixel * 4;
    rgba[to] = rgb[from] ?? 0;
    rgba[to + 1] = rgb[from + 1] ?? 0;
    rgba[to + 2] = rgb[from + 2] ?? 0;
    rgba[to + 3] = opaque;
  }
  return rgba;
}
