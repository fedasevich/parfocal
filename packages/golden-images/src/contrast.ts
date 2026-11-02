import type { Frame } from "#frame.ts";

export type Color = readonly [red: number, green: number, blue: number, ...rest: number[]];

function linear(channel: number): number {
  const unit = channel / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([red, green, blue]: Color): number {
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

export function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface OutlineContrast {
  readonly pixels: number;
  readonly lineBelow: number;
  readonly bothBelow: number;
}

export function outlineContrast(
  frames: readonly Frame[],
  line: Color,
  casing: Color,
  minimumRatio = 3,
): OutlineContrast {
  const lineLuminance = relativeLuminance(line);
  const casingLuminance = relativeLuminance(casing);
  let pixels = 0;
  let lineBelow = 0;
  let bothBelow = 0;
  for (const frame of frames) {
    for (let offset = 0; offset < frame.data.length; offset += 4) {
      const tissue = relativeLuminance([
        frame.data[offset] ?? 0,
        frame.data[offset + 1] ?? 0,
        frame.data[offset + 2] ?? 0,
      ]);
      pixels++;
      if (contrastRatio(lineLuminance, tissue) >= minimumRatio) continue;
      lineBelow++;
      if (contrastRatio(casingLuminance, tissue) < minimumRatio) bothBelow++;
    }
  }
  return { pixels, lineBelow, bothBelow };
}
