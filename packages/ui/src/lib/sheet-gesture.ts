export const sheetHeights = ["peek", "half", "full"] as const;

export type SheetHeight = (typeof sheetHeights)[number];

export type SheetPixels = Record<SheetHeight, number>;

export const flingVelocity = 0.5;

export const swipeDistance = 60;

export const swipeWindowMs = 600;

export function dragHeight(startPx: number, upwardPx: number, pixels: SheetPixels): number {
  return Math.min(pixels.full, Math.max(pixels.peek, startPx + upwardPx));
}

export function settleHeight(
  current: SheetHeight,
  heightPx: number,
  upwardVelocity: number,
  pixels: SheetPixels,
): SheetHeight {
  const index = sheetHeights.indexOf(current);
  if (Math.abs(upwardVelocity) >= flingVelocity) {
    const step = upwardVelocity > 0 ? 1 : -1;
    const next = Math.min(sheetHeights.length - 1, Math.max(0, index + step));
    return sheetHeights[next] ?? current;
  }
  return sheetHeights.reduce((nearest, name) =>
    Math.abs(pixels[name] - heightPx) < Math.abs(pixels[nearest] - heightPx) ? name : nearest,
  );
}

export function isNextCellSwipe(dx: number, dy: number, elapsedMs: number): boolean {
  return dx <= -swipeDistance && Math.abs(dy) < Math.abs(dx) / 2 && elapsedMs <= swipeWindowMs;
}
