import * as zarr from "zarrita";
import { checkTile, checkWindow, levelAt, tileWindow } from "../geometry.ts";
import type {
  ChannelInfo,
  MicronsPerPixel,
  OpenRequest,
  Photometric,
  PixelArray,
  PixelDtype,
  PixelLevel,
  PixelResult,
  PixelSource,
  PixelWindow,
  RasterRequest,
  TileRequest,
} from "../types.ts";
import { SourceClosedError } from "../types.ts";
import { absoluteUrl } from "../url.ts";
import { AbsentChunkError, slideStore } from "./store.ts";

interface Axis {
  readonly name: string;
  readonly unit?: string;
}

interface Transform {
  readonly type: string;
  readonly scale?: readonly number[];
}

interface Dataset {
  readonly path: string;
  readonly coordinateTransformations?: readonly Transform[];
}

interface Multiscale {
  readonly axes?: readonly (Axis | string)[];
  readonly datasets: readonly Dataset[];
}

interface OmeroChannel {
  readonly label?: string;
  readonly color?: string;
  readonly window?: { readonly start?: number; readonly end?: number };
}

interface OmeAttributes {
  readonly multiscales?: readonly Multiscale[];
  readonly omero?: { readonly channels?: readonly OmeroChannel[] };
  readonly ome?: {
    readonly multiscales?: readonly Multiscale[];
    readonly omero?: { readonly channels?: readonly OmeroChannel[] };
  };
}

type NumberArray = zarr.Array<PixelDtype, zarr.Readable>;

interface ZarrLevel extends PixelLevel {
  readonly array: NumberArray;
}

interface AxisIndex {
  readonly c: number | null;
  readonly y: number;
  readonly x: number;
  readonly count: number;
}

const micronsPerUnit: Record<string, number> = {
  meter: 1e6,
  centimeter: 1e4,
  millimeter: 1e3,
  micrometer: 1,
  nanometer: 1e-3,
};

const pixelDtypes = new Set<string>([
  "uint8",
  "uint16",
  "uint32",
  "int8",
  "int16",
  "int32",
  "float32",
  "float64",
]);

const defaultAxes = ["t", "c", "z", "y", "x"];

function axisNames(multiscale: Multiscale): string[] {
  return (multiscale.axes ?? defaultAxes).map((axis) =>
    typeof axis === "string" ? axis : axis.name,
  );
}

function axisIndex(names: readonly string[]): AxisIndex {
  const y = names.indexOf("y");
  const x = names.indexOf("x");
  const c = names.indexOf("c");
  if (y === -1 || x === -1)
    throw new Error(`OME-Zarr axes must include y and x, got ${names.join(",")}`);
  if (c > y || c > x) throw new Error("OME-Zarr channel axis must come before y and x");
  return { c: c === -1 ? null : c, y, x, count: names.length };
}

function scaleOf(dataset: Dataset | undefined): readonly number[] | undefined {
  return dataset?.coordinateTransformations?.find((transform) => transform.type === "scale")?.scale;
}

function micronsPerPixel(multiscale: Multiscale, axes: AxisIndex): MicronsPerPixel | null {
  const scale = scaleOf(multiscale.datasets[0]);
  if (scale === undefined) return null;
  const size = (index: number) => {
    const axis = multiscale.axes?.[index];
    const unit = typeof axis === "object" ? axis.unit : undefined;
    const value = scale[index];
    const factor = unit === undefined ? undefined : micronsPerUnit[unit];
    return value === undefined || factor === undefined ? Number.NaN : value * factor;
  };
  const x = size(axes.x);
  const y = size(axes.y);
  return Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0 ? { x, y } : null;
}

function colorOf(hex: string | undefined): readonly [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "")?.[1];
  if (match === undefined) return null;
  return [
    Number.parseInt(match.slice(0, 2), 16),
    Number.parseInt(match.slice(2, 4), 16),
    Number.parseInt(match.slice(4, 6), 16),
  ];
}

function channelsOf(count: number, omero: readonly OmeroChannel[]): ChannelInfo[] {
  return Array.from({ length: count }, (_, index) => {
    const channel = omero[index];
    const start = channel?.window?.start;
    const end = channel?.window?.end;
    return {
      name: channel?.label ?? `Channel ${index + 1}`,
      color: colorOf(channel?.color),
      window: start !== undefined && end !== undefined && end > start ? [start, end] : null,
    };
  });
}

const rgbColors = ["ff0000", "00ff00", "0000ff"];

function photometricOf(
  dtype: PixelDtype,
  channels: readonly ChannelInfo[],
  omero: readonly OmeroChannel[],
): Photometric {
  if (channels.length === 1) return "grey";
  const colored =
    omero.length === 0 ||
    omero.every(
      (channel, index) => channel.color?.toLowerCase().replace("#", "") === rgbColors[index],
    );
  return dtype === "uint8" && channels.length === 3 && colored ? "rgb" : "channels";
}

async function openRoot(
  store: zarr.AsyncReadable,
  version: 2 | 3 | undefined,
): Promise<zarr.Group<zarr.Readable>> {
  if (version === 2) return zarr.open.v2(store, { kind: "group" });
  if (version === 3) return zarr.open.v3(store, { kind: "group" });
  return zarr.open(store, { kind: "group" });
}

function isNumberArray(array: zarr.Array<zarr.DataType, zarr.Readable>): array is NumberArray {
  return pixelDtypes.has(array.dtype);
}

const constructors = {
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
  int8: Int8Array,
  int16: Int16Array,
  int32: Int32Array,
  float32: Float32Array,
  float64: Float64Array,
} satisfies Record<PixelDtype, { new (length: number): PixelArray }>;

function allocate(dtype: PixelDtype, length: number): PixelArray {
  return new constructors[dtype](length);
}

function planesOf(
  chunk: zarr.Chunk<PixelDtype>,
  channels: number,
  width: number,
  height: number,
): PixelArray[] {
  const { data } = chunk;
  const size = width * height;
  return Array.from(
    { length: channels },
    (_, index) => data.slice(index * size, (index + 1) * size) as PixelArray,
  );
}

export async function openOmeZarrSource(request: OpenRequest): Promise<PixelSource> {
  const url = absoluteUrl(request.url, request.baseUrl);
  const fetcher = request.fetch;
  const store = slideStore(
    new zarr.FetchStore(
      url.href,
      fetcher === undefined ? {} : { fetch: (inner: Request) => fetcher(inner) },
    ),
  );
  const root = await openRoot(store, request.index?.zarrVersion);
  const attributes = root.attrs as OmeAttributes;
  const multiscale = (attributes.ome?.multiscales ?? attributes.multiscales)?.[0];
  if (multiscale === undefined) throw new Error("The store has no OME multiscales metadata");
  const axes = axisIndex(axisNames(multiscale));
  const arrays = await Promise.all(
    multiscale.datasets.map(async (dataset) => {
      const array = await zarr.open(root.resolve(dataset.path), { kind: "array" });
      if (!isNumberArray(array)) throw new Error(`Unsupported OME-Zarr data type ${array.dtype}`);
      return array;
    }),
  );
  const [baseArray] = arrays;
  if (baseArray === undefined) throw new Error("The OME multiscales block lists no datasets");
  const baseWidth = baseArray.shape[axes.x] ?? 0;
  const levels: ZarrLevel[] = arrays.map((array, index) => {
    const width = array.shape[axes.x] ?? 0;
    const scale = scaleOf(multiscale.datasets[index])?.[axes.x];
    const baseScale = scaleOf(multiscale.datasets[0])?.[axes.x];
    const declared =
      scale !== undefined && baseScale !== undefined && baseScale > 0
        ? scale / baseScale
        : undefined;
    return {
      array,
      downsample: declared ?? baseWidth / width,
      width,
      height: array.shape[axes.y] ?? 0,
      tileWidth: array.chunks[axes.x] ?? width,
      tileHeight: array.chunks[axes.y] ?? 0,
    };
  });
  const base = levelAt(levels, 0);
  const { dtype } = baseArray;
  const omero = attributes.ome?.omero?.channels ?? attributes.omero?.channels ?? [];
  const channelCount = axes.c === null ? 1 : (baseArray.shape[axes.c] ?? 1);
  const channels = channelsOf(channelCount, omero);
  const photometric = photometricOf(dtype, channels, omero);
  const declaredMicrons = micronsPerPixel(multiscale, axes);
  let closed = false;

  const selection = (window: PixelWindow): (number | zarr.Slice | null)[] =>
    Array.from({ length: axes.count }, (_, index) => {
      if (index === axes.x) return zarr.slice(window[0], window[2]);
      if (index === axes.y) return zarr.slice(window[1], window[3]);
      if (index === axes.c) return null;
      return 0;
    });

  const readWindow = async (
    level: ZarrLevel,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<PixelResult> => {
    const width = window[2] - window[0];
    const height = window[3] - window[1];
    try {
      const chunk = await zarr.get(level.array, selection(window), signal ? { signal } : {});
      return { absent: false, width, height, planes: planesOf(chunk, channelCount, width, height) };
    } catch (error) {
      if (error instanceof AbsentChunkError) return { absent: true, width, height };
      throw error;
    }
  };

  const compose = async (
    level: ZarrLevel,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<PixelResult> => {
    const [x0, y0, x1, y1] = window;
    const width = x1 - x0;
    const height = y1 - y0;
    const background = photometric === "rgb" ? 255 : 0;
    const planes = Array.from({ length: channelCount }, () => allocate(dtype, width * height));
    let anyPresent = false;
    for (let ty = Math.floor(y0 / level.tileHeight); ty * level.tileHeight < y1; ty++) {
      for (let tx = Math.floor(x0 / level.tileWidth); tx * level.tileWidth < x1; tx++) {
        const tile = tileWindow(level, tx, ty);
        const result = await readWindow(level, tile, signal);
        const left = Math.max(x0, tile[0]);
        const top = Math.max(y0, tile[1]);
        const right = Math.min(x1, tile[2]);
        const bottom = Math.min(y1, tile[3]);
        for (let y = top; y < bottom; y++) {
          for (const [index, plane] of planes.entries()) {
            const start = (y - y0) * width + (left - x0);
            if (result.absent) {
              plane.fill(background, start, start + right - left);
            } else {
              const source = result.planes[index];
              const from = (y - tile[1]) * result.width + (left - tile[0]);
              if (source !== undefined)
                plane.set(source.subarray(from, from + right - left), start);
            }
          }
        }
        anyPresent ||= !result.absent;
      }
    }
    if (!anyPresent) return { absent: true, width, height };
    return { absent: false, width, height, planes };
  };

  const ensureOpen = (signal?: AbortSignal) => {
    if (closed) throw new SourceClosedError();
    signal?.throwIfAborted();
  };

  return {
    formatId: request.formatId,
    levels,
    tileSize: { width: base.tileWidth, height: base.tileHeight },
    micronsPerPixel:
      request.index?.micronsPerPixel !== undefined
        ? request.index.micronsPerPixel
        : declaredMicrons,
    photometric,
    dtype,
    channels,
    async getTile(tile: TileRequest) {
      const level = checkTile(levels, tile);
      ensureOpen(tile.signal);
      return readWindow(level, tileWindow(level, tile.x, tile.y), tile.signal);
    },
    async getRaster(raster: RasterRequest) {
      const level = levelAt(levels, raster.level);
      const window = checkWindow(level, raster.window);
      ensureOpen(raster.signal);
      const whole = await readWindow(level, window, raster.signal);
      if (!whole.absent) return whole;
      return compose(level, window, raster.signal);
    },
    close() {
      closed = true;
    },
  };
}
