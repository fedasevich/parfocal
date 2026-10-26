import type {
  ChannelInfo,
  PixelArray,
  PixelDtype,
  PixelResult,
  PixelSource,
} from "../pixel-source/types.ts";
import {
  UnsupportedVivSourceError,
  type VirtualLevel,
  virtualLadder,
  vivSignalAborted,
  vivTileSize,
} from "./viv-levels.ts";

export type VivChannelDtype = "Uint8" | "Uint16";

export type VivChannelArray = Uint8Array | Uint16Array;

export interface VivChannelSelection {
  readonly c: number;
  readonly z?: number;
  readonly t?: number;
}

export interface VivChannelTile {
  readonly data: VivChannelArray;
  readonly width: number;
  readonly height: number;
}

export interface VivChannelLevel {
  readonly shape: [channels: number, height: number, width: number];
  readonly labels: ["c", "y", "x"];
  readonly dtype: VivChannelDtype;
  readonly tileSize: number;
  getTile(request: {
    readonly x: number;
    readonly y: number;
    readonly selection: VivChannelSelection;
    readonly signal?: AbortSignal;
  }): Promise<VivChannelTile>;
  getRaster(request: {
    readonly selection: VivChannelSelection;
    readonly signal?: AbortSignal;
  }): Promise<VivChannelTile>;
  onTileError(error: Error): void;
}

export interface VivChannelLevels {
  readonly levels: readonly VivChannelLevel[];
  readonly ladder: readonly VirtualLevel[];
  readonly tileSize: number;
  readonly dtype: VivChannelDtype;
  readonly channels: readonly ChannelInfo[];
  readonly pending: () => number;
}

export interface VivChannelLevelOptions {
  readonly onTileError?: (error: Error) => void;
  readonly onReadSettled?: () => void;
}

const vivDtypes: Partial<Record<PixelDtype, VivChannelDtype>> = {
  uint8: "Uint8",
  uint16: "Uint16",
};

export const maxSampleValue: Readonly<Record<VivChannelDtype, number>> = {
  Uint8: 255,
  Uint16: 65_535,
};

export function vivChannelDtype(source: Pick<PixelSource, "dtype">): VivChannelDtype {
  const dtype = vivDtypes[source.dtype];
  if (dtype === undefined) {
    throw new UnsupportedVivSourceError(`its samples are ${source.dtype}`);
  }
  return dtype;
}

function assertChannels(source: PixelSource): void {
  if (source.photometric === "rgb") {
    throw new UnsupportedVivSourceError("it is RGB, which the RGB levels draw");
  }
  if (source.channels.length < 1) {
    throw new UnsupportedVivSourceError("it has no channels");
  }
  vivChannelDtype(source);
}

export function boxDownsamplePlane(
  plane: PixelArray,
  dtype: VivChannelDtype,
  sourceWidth: number,
  sourceHeight: number,
  residual: number,
  width: number,
  height: number,
): VivChannelArray {
  const out = dtype === "Uint8" ? new Uint8Array(width * height) : new Uint16Array(width * height);
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
      out[y * width + x] = Math.floor((2 * sum + count) / (2 * count));
    }
  }
  return out;
}

function emptyTile(dtype: VivChannelDtype, width: number, height: number): VivChannelTile {
  const data = dtype === "Uint8" ? new Uint8Array(width * height) : new Uint16Array(width * height);
  return { data, width, height };
}

export function createVivChannelLevels(
  source: PixelSource,
  options: VivChannelLevelOptions = {},
): VivChannelLevels {
  assertChannels(source);
  const dtype = vivChannelDtype(source);
  const tileSize = vivTileSize(source);
  const ladder = virtualLadder(source.levels, tileSize);
  let inFlight = 0;

  const toTile = (
    result: PixelResult,
    channel: number,
    residual: number,
    width: number,
    height: number,
  ): VivChannelTile => {
    if (result.absent) return emptyTile(dtype, width, height);
    const plane = result.planes[channel];
    if (plane === undefined) throw new RangeError(`Channel ${channel} is missing`);
    return {
      data: boxDownsamplePlane(plane, dtype, result.width, result.height, residual, width, height),
      width,
      height,
    };
  };

  const readRegion = async (
    virtual: VirtualLevel,
    region: readonly [number, number, number, number],
    channel: number,
    signal: AbortSignal | undefined,
  ): Promise<VivChannelTile> => {
    const backing = source.levels[virtual.backing];
    if (backing === undefined) throw new RangeError(`Level ${virtual.backing} is missing`);
    if (!Number.isInteger(channel) || channel < 0 || channel >= source.channels.length) {
      throw new RangeError(`Channel ${channel} is outside the slide`);
    }
    const [x0, y0, x1, y1] = region;
    const { residual } = virtual;
    inFlight++;
    try {
      if (signal?.aborted) throw vivSignalAborted;
      const result = await source.getRaster({
        level: virtual.backing,
        window: [
          x0 * residual,
          y0 * residual,
          Math.min(x1 * residual, backing.width),
          Math.min(y1 * residual, backing.height),
        ],
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) throw vivSignalAborted;
      return toTile(result, channel, residual, x1 - x0, y1 - y0);
    } catch (error) {
      if (signal?.aborted) throw vivSignalAborted;
      throw error;
    } finally {
      inFlight--;
      options.onReadSettled?.();
    }
  };

  const onTileError =
    options.onTileError ??
    ((error: Error) => {
      console.error(error);
    });

  const levels = ladder.map((virtual): VivChannelLevel => {
    const columns = Math.ceil(virtual.width / tileSize);
    const rows = Math.ceil(virtual.height / tileSize);
    return {
      shape: [source.channels.length, virtual.height, virtual.width],
      labels: ["c", "y", "x"],
      dtype,
      tileSize,
      getTile: ({ x, y, selection, signal }) => {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
          return Promise.reject(new RangeError(`Tile ${x},${y} is not a tile index`));
        }
        if (x >= columns || y >= rows) {
          return Promise.reject(new RangeError(`Tile ${x},${y} is outside the level`));
        }
        const x0 = x * tileSize;
        const y0 = y * tileSize;
        return readRegion(
          virtual,
          [x0, y0, Math.min(x0 + tileSize, virtual.width), Math.min(y0 + tileSize, virtual.height)],
          selection.c,
          signal,
        );
      },
      getRaster: ({ selection, signal }) =>
        readRegion(virtual, [0, 0, virtual.width, virtual.height], selection.c, signal),
      onTileError,
    };
  });

  return { levels, ladder, tileSize, dtype, channels: source.channels, pending: () => inFlight };
}

export interface ChannelDisplay {
  readonly visible?: boolean;
  readonly color?: readonly [number, number, number];
  readonly contrast?: readonly [number, number];
}

export interface VivChannelLayerProps {
  readonly selections: readonly VivChannelSelection[];
  readonly contrastLimits: readonly (readonly [number, number])[];
  readonly colors: readonly (readonly [number, number, number])[];
  readonly channelsVisible: readonly boolean[];
  readonly dtype: VivChannelDtype;
}

const fallbackColor: readonly [number, number, number] = [255, 255, 255];

export function vivChannelLayerProps(
  levels: Pick<VivChannelLevels, "channels" | "dtype">,
  display: readonly ChannelDisplay[] = [],
): VivChannelLayerProps {
  const top = maxSampleValue[levels.dtype];
  return {
    dtype: levels.dtype,
    selections: levels.channels.map((_, c) => ({ c, z: 0, t: 0 })),
    contrastLimits: levels.channels.map((channel, c) => {
      const chosen = display[c]?.contrast ?? channel.window ?? [0, top];
      return [Math.max(0, chosen[0]), Math.min(top, chosen[1])] as const;
    }),
    colors: levels.channels.map(
      (channel, c) => display[c]?.color ?? channel.color ?? fallbackColor,
    ),
    channelsVisible: levels.channels.map((_, c) => display[c]?.visible ?? true),
  };
}
