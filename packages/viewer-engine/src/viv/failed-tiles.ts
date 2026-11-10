export interface FailedTile {
  readonly key: string;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TileLevelSize {
  readonly width: number;
  readonly height: number;
  readonly downsample: number;
}

export interface FailedTiles {
  readonly tileOf: (level: number, size: TileLevelSize, x: number, y: number) => FailedTile;
  readonly failed: (tile: FailedTile, part?: number) => void;
  readonly read: (tile: FailedTile, part?: number) => void;
  readonly list: () => readonly FailedTile[];
  readonly clear: (key: string) => void;
}

export function createFailedTiles(
  tileSize: number,
  base: Pick<TileLevelSize, "width" | "height"> | undefined,
): FailedTiles {
  const failures = new Map<string, { readonly tile: FailedTile; readonly parts: Set<number> }>();

  return {
    tileOf(level, size, x, y) {
      const left = x * tileSize * size.downsample;
      const top = y * tileSize * size.downsample;
      const right = Math.min((x + 1) * tileSize, size.width) * size.downsample;
      const bottom = Math.min((y + 1) * tileSize, size.height) * size.downsample;
      return {
        key: `${level}/${x}/${y}`,
        level,
        x,
        y,
        left,
        top,
        width: Math.min(right, base?.width ?? right) - left,
        height: Math.min(bottom, base?.height ?? bottom) - top,
      };
    },
    failed(tile, part = 0) {
      const entry = failures.get(tile.key) ?? { tile, parts: new Set<number>() };
      entry.parts.add(part);
      failures.set(tile.key, entry);
    },
    read(tile, part = 0) {
      const entry = failures.get(tile.key);
      if (entry === undefined) return;
      entry.parts.delete(part);
      if (entry.parts.size === 0) failures.delete(tile.key);
    },
    list: () => [...failures.values()].map((entry) => entry.tile),
    clear(key) {
      failures.delete(key);
    },
  };
}
