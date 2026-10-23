import type { PixelLevel, PixelWindow, TileRequest } from "./types.ts";

export interface StoredLevel {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export interface LadderStep {
  readonly stored: number;
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function fits(base: number, stored: number, tile: number, factor: number): boolean {
  const exact = base / factor;
  return Math.floor(exact) - 1 <= stored && stored <= ceilTo(Math.ceil(exact), tile);
}

export function recoverLadder(stored: readonly StoredLevel[]): LadderStep[] {
  const [base] = stored;
  if (base === undefined) return [];
  const steps: LadderStep[] = [
    { stored: 0, downsample: 1, width: base.width, height: base.height },
  ];
  const limit = Math.max(base.width, base.height);
  stored.forEach((level, index) => {
    if (index === 0) return;
    const previous = steps.at(-1)?.downsample ?? 1;
    for (let factor = previous * 2; factor <= limit; factor *= 2) {
      if (
        fits(base.width, level.width, level.tileWidth, factor) &&
        fits(base.height, level.height, level.tileHeight, factor)
      ) {
        steps.push({
          stored: index,
          downsample: factor,
          width: Math.min(level.width, Math.ceil(base.width / factor)),
          height: Math.min(level.height, Math.ceil(base.height / factor)),
        });
        return;
      }
    }
  });
  return steps;
}

export function tileWindow(level: PixelLevel, x: number, y: number): PixelWindow {
  const x0 = x * level.tileWidth;
  const y0 = y * level.tileHeight;
  return [
    x0,
    y0,
    Math.min(x0 + level.tileWidth, level.width),
    Math.min(y0 + level.tileHeight, level.height),
  ];
}

export function tileColumns(level: PixelLevel): number {
  return Math.ceil(level.width / level.tileWidth);
}

export function tileRows(level: PixelLevel): number {
  return Math.ceil(level.height / level.tileHeight);
}

export function levelAt<L extends PixelLevel>(levels: readonly L[], index: number): L {
  const level = levels[index];
  if (level === undefined || !Number.isInteger(index)) {
    throw new RangeError(`Level ${index} is outside 0 to ${levels.length - 1}`);
  }
  return level;
}

export function checkTile<L extends PixelLevel>(levels: readonly L[], request: TileRequest): L {
  const level = levelAt(levels, request.level);
  const { x, y } = request;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= tileColumns(level) ||
    y >= tileRows(level)
  ) {
    throw new RangeError(`Tile ${x},${y} is outside level ${request.level}`);
  }
  return level;
}

export function checkWindow(level: PixelLevel, window: PixelWindow | undefined): PixelWindow {
  if (window === undefined) return [0, 0, level.width, level.height];
  const [x0, y0, x1, y1] = window;
  if (
    ![x0, y0, x1, y1].every(Number.isInteger) ||
    x0 < 0 ||
    y0 < 0 ||
    x1 > level.width ||
    y1 > level.height ||
    x1 <= x0 ||
    y1 <= y0
  ) {
    throw new RangeError(`Window ${window.join(",")} is outside the level`);
  }
  return window;
}
