import { DecodePoolDisposedError } from "../decode/decode-pool.ts";
import type {
  PixelArray,
  PixelLevel,
  PixelResult,
  PixelSource,
  PixelWindow,
} from "../pixel-source/types.ts";
import { createTileWait, type TileLoadState } from "./tile-wait.ts";

export const vivSignalAborted: unknown = "__vivSignalAborted";

export const rgbPhotometricInterpretation = 2;

export const rgbBackground = 255;

const largestVivTile = 1024;

const fallbackVivTile = 512;

export interface VirtualLevel {
  readonly downsample: number;
  readonly backing: number;
  readonly residual: number;
  readonly width: number;
  readonly height: number;
}

export interface VivTile {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export interface VivTileSelection {
  readonly x: number;
  readonly y: number;
  readonly signal?: AbortSignal;
}

export interface VivRasterSelection {
  readonly signal?: AbortSignal;
}

export interface VivLevel {
  readonly shape: number[];
  readonly labels: ["y", "x", "_c"];
  readonly dtype: "Uint8";
  readonly tileSize: number;
  readonly meta: { readonly photometricInterpretation: number };
  getTile(selection: VivTileSelection): Promise<VivTile>;
  getRaster(selection: VivRasterSelection): Promise<VivTile>;
  onTileError(error: Error): void;
}

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

export interface VivLevels {
  readonly failures: () => readonly FailedTile[];
  readonly clearFailure: (key: string) => void;
  readonly levels: readonly VivLevel[];
  readonly ladder: readonly VirtualLevel[];
  readonly tileSize: number;
  readonly pending: () => number;
  readonly loadState: () => TileLoadState;
  readonly regionFor: (level: number, x: number, y: number) => PlannedRegion | null;
}

export interface PlannedRegion {
  readonly region: VivRegion;
  readonly centre: RegionCentre;
}

export interface VivRegion {
  readonly backing: number;
  readonly residual: number;
  readonly window: PixelWindow;
  readonly width: number;
  readonly height: number;
  readonly channel?: number;
}

export interface RegionCentre {
  readonly x: number;
  readonly y: number;
}

export type VivRegionReader = (
  region: VivRegion,
  centre: RegionCentre,
  signal?: AbortSignal,
) => Promise<VivTile>;

export interface VivLevelOptions {
  readonly onTileError?: (error: Error) => void;
  readonly read?: VivRegionReader;
  readonly onReadSettled?: () => void;
  readonly now?: () => number;
}

export class UnsupportedVivSourceError extends Error {
  constructor(reason: string) {
    super(`The Viv RGB route cannot draw this slide: ${reason}`);
    this.name = "UnsupportedVivSourceError";
  }
}

export function vivTileSize(source: Pick<PixelSource, "tileSize">): number {
  const { width, height } = source.tileSize;
  return width === height && width > 0 && width <= largestVivTile ? width : fallbackVivTile;
}

export function virtualLadder(levels: readonly PixelLevel[], tileSize: number): VirtualLevel[] {
  const [base] = levels;
  if (base === undefined) throw new UnsupportedVivSourceError("it has no levels");
  const ladder: VirtualLevel[] = [];
  for (let step = 0; ; step++) {
    const downsample = 2 ** step;
    let backing = 0;
    levels.forEach((level, index) => {
      if (level.downsample <= downsample && level.downsample > (levels[backing]?.downsample ?? 1)) {
        backing = index;
      }
    });
    const backingLevel = levels[backing] ?? base;
    const residual = downsample / backingLevel.downsample;
    if (!Number.isInteger(residual)) {
      throw new UnsupportedVivSourceError(
        `level ${backing} has downsample ${backingLevel.downsample}, which is not a power of two`,
      );
    }
    const width = Math.max(1, Math.ceil(base.width / downsample));
    const height = Math.max(1, Math.ceil(base.height / downsample));
    ladder.push({ downsample, backing, residual, width, height });
    if (width <= tileSize && height <= tileSize) return ladder;
  }
}

export function boxDownsampleToInterleaved(
  planes: readonly PixelArray[],
  sourceWidth: number,
  sourceHeight: number,
  residual: number,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height * 3);
  for (let channel = 0; channel < 3; channel++) {
    const plane = planes[channel];
    if (plane === undefined) throw new UnsupportedVivSourceError(`plane ${channel} is missing`);
    for (let y = 0; y < height; y++) {
      const top = y * residual;
      const bottom = Math.min(top + residual, sourceHeight);
      for (let x = 0; x < width; x++) {
        const left = x * residual;
        const right = Math.min(left + residual, sourceWidth);
        let sum = 0;
        for (let row = top; row < bottom; row++) {
          const start = row * sourceWidth;
          for (let column = left; column < right; column++) sum += plane[start + column] ?? 0;
        }
        const count = (bottom - top) * (right - left);
        out[(y * width + x) * 3 + channel] = Math.floor((2 * sum + count) / (2 * count));
      }
    }
  }
  return out;
}

function assertDrawable(source: PixelSource): void {
  if (source.photometric !== "rgb") {
    throw new UnsupportedVivSourceError(`its photometric mode is ${source.photometric}`);
  }
  if (source.dtype !== "uint8") {
    throw new UnsupportedVivSourceError(`its samples are ${source.dtype}`);
  }
  if (source.channels.length !== 3) {
    throw new UnsupportedVivSourceError(`it has ${source.channels.length} channels`);
  }
}

function backgroundTile(width: number, height: number): VivTile {
  return { data: new Uint8Array(width * height * 3).fill(rgbBackground), width, height };
}

function toTile(result: PixelResult, region: VivRegion): VivTile {
  const { width, height } = region;
  if (result.absent) return backgroundTile(width, height);
  return {
    data: boxDownsampleToInterleaved(
      result.planes,
      result.width,
      result.height,
      region.residual,
      width,
      height,
    ),
    width,
    height,
  };
}

export async function readVivRegion(
  source: PixelSource,
  region: VivRegion,
  signal?: AbortSignal,
): Promise<VivTile> {
  const result = await source.getRaster({
    level: region.backing,
    window: region.window,
    ...(signal ? { signal } : {}),
  });
  return toTile(result, region);
}

export function regionKey(region: VivRegion): string {
  const channel = region.channel === undefined ? "" : `/c${region.channel}`;
  return `${region.backing}/${region.residual}/${region.window.join(",")}${channel}`;
}

export function createVivLevels(source: PixelSource, options: VivLevelOptions = {}): VivLevels {
  assertDrawable(source);
  const tileSize = vivTileSize(source);
  const ladder = virtualLadder(source.levels, tileSize);
  const wait = createTileWait(options.now ?? (() => performance.now()));

  const read: VivRegionReader =
    options.read ?? ((region, _centre, signal) => readVivRegion(source, region, signal));

  const plan = (
    virtual: VirtualLevel,
    region: readonly [number, number, number, number],
  ): PlannedRegion => {
    const backing = source.levels[virtual.backing];
    if (backing === undefined) throw new RangeError(`Level ${virtual.backing} is missing`);
    const [x0, y0, x1, y1] = region;
    const { residual } = virtual;
    return {
      region: {
        backing: virtual.backing,
        residual,
        window: [
          x0 * residual,
          y0 * residual,
          Math.min(x1 * residual, backing.width),
          Math.min(y1 * residual, backing.height),
        ],
        width: x1 - x0,
        height: y1 - y0,
      },
      centre: {
        x: ((x0 + x1) / 2) * virtual.downsample,
        y: ((y0 + y1) / 2) * virtual.downsample,
      },
    };
  };

  const tileRegion = (
    virtual: VirtualLevel,
    x: number,
    y: number,
  ): readonly [number, number, number, number] => {
    const x0 = x * tileSize;
    const y0 = y * tileSize;
    return [
      x0,
      y0,
      Math.min(x0 + tileSize, virtual.width),
      Math.min(y0 + tileSize, virtual.height),
    ];
  };

  const regionFor = (level: number, x: number, y: number): PlannedRegion | null => {
    const virtual = ladder[level];
    if (virtual === undefined) return null;
    if (x < 0 || y < 0 || x >= Math.ceil(virtual.width / tileSize)) return null;
    if (y >= Math.ceil(virtual.height / tileSize)) return null;
    return plan(virtual, tileRegion(virtual, x, y));
  };

  const readRegion = async (
    virtual: VirtualLevel,
    region: readonly [number, number, number, number],
    signal: AbortSignal | undefined,
  ): Promise<VivTile> => {
    const { region: request, centre } = plan(virtual, region);
    const id = wait.begin();
    let answered = false;
    try {
      if (signal?.aborted) throw vivSignalAborted;
      const tile = await read(request, centre, signal);
      if (signal?.aborted) throw vivSignalAborted;
      answered = true;
      return tile;
    } catch (error) {
      if (signal?.aborted || error instanceof DecodePoolDisposedError) throw vivSignalAborted;
      throw error;
    } finally {
      wait.end(id, answered);
      options.onReadSettled?.();
    }
  };

  const onTileError =
    options.onTileError ??
    ((error: Error) => {
      console.error(error);
    });

  const failed = new Map<string, FailedTile>();
  const base = ladder[0];

  const failedTileOf = (level: number, virtual: VirtualLevel, x: number, y: number): FailedTile => {
    const left = x * tileSize * virtual.downsample;
    const top = y * tileSize * virtual.downsample;
    const right = Math.min((x + 1) * tileSize, virtual.width) * virtual.downsample;
    const bottom = Math.min((y + 1) * tileSize, virtual.height) * virtual.downsample;
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
  };

  const levels = ladder.map((virtual, level): VivLevel => {
    const columns = Math.ceil(virtual.width / tileSize);
    const rows = Math.ceil(virtual.height / tileSize);
    return {
      shape: [virtual.height, virtual.width, 3],
      labels: ["y", "x", "_c"],
      dtype: "Uint8",
      tileSize,
      meta: { photometricInterpretation: rgbPhotometricInterpretation },
      getTile: ({ x, y, signal }) => {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
          return Promise.reject(new RangeError(`Tile ${x},${y} is not a tile index`));
        }
        if (x >= columns || y >= rows) {
          return Promise.reject(new RangeError(`Tile ${x},${y} is outside the level`));
        }
        const tile = failedTileOf(level, virtual, x, y);
        return readRegion(virtual, tileRegion(virtual, x, y), signal).then(
          (result) => {
            failed.delete(tile.key);
            return result;
          },
          (error: unknown) => {
            if (error !== vivSignalAborted) failed.set(tile.key, tile);
            throw error;
          },
        );
      },
      getRaster: ({ signal }) => readRegion(virtual, [0, 0, virtual.width, virtual.height], signal),
      onTileError,
    };
  });

  return {
    failures: () => [...failed.values()],
    clearFailure: (key) => {
      failed.delete(key);
    },
    levels,
    ladder,
    tileSize,
    pending: () => wait.state().pending,
    loadState: wait.state,
    regionFor,
  };
}
