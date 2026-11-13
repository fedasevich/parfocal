import { getDecoder } from "geotiff";
import { checkTile, checkWindow, levelAt, tileWindow } from "../geometry.ts";
import { browserTileDecoder } from "../tiff/native-jpeg.ts";
import {
  type ChannelInfo,
  type DecodeReport,
  type JpegDecoderChoice,
  type JpegDecoderReason,
  type MicronsPerPixel,
  type NativeTileDecoder,
  type OpenRequest,
  type PixelLevel,
  type PixelResult,
  type PixelSource,
  type PixelWindow,
  type RasterRequest,
  SourceClosedError,
  type TileRequest,
  UnsupportedFormatError,
} from "../types.ts";
import { absoluteUrl } from "../url.ts";
import {
  type ByteReader,
  NdpiFormatError,
  type NdpiPage,
  readNdpiPages,
  readRational,
  readRestartStarts,
} from "./directory.ts";
import {
  buildNdpiJpeg,
  type NdpiFrame,
  parseNdpiFrame,
  withoutEndOfImage,
  ycbcrToRgb,
} from "./jpeg.ts";

export const ndpiTileSize = 512;
export const ndpiUnitCacheBytes = 96 * 1024 * 1024;

const jpegCompression = 7;
const headerProbes = [4096, 65536] as const;
const wholeLevelPixels = 2 ** 26;
const mergeGap = 4096;
const agreementThreshold = 3;
const centimetre = 3;

const rgbChannels: readonly ChannelInfo[] = [
  { name: "Red", color: [255, 0, 0], window: null },
  { name: "Green", color: [0, 255, 0], window: null },
  { name: "Blue", color: [0, 0, 255], window: null },
];

interface NdpiLevel extends PixelLevel {
  readonly page: NdpiPage;
  readonly frame: NdpiFrame;
  readonly intervalsPerRow: number;
  readonly unitIntervals: number;
  readonly unitWidth: number;
  readonly bandRows: number;
  readonly bandHeight: number;
  readonly mcuRows: number;
  readonly whole: boolean;
}

interface Unit {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

interface Decision {
  readonly jpeg: JpegDecoderChoice;
  readonly reason: JpegDecoderReason;
  readonly meanAbsoluteError: number | null;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

export function rangeReader(url: string, fetcher: typeof globalThis.fetch): ByteReader {
  return async (offset, length, signal) => {
    const response = await fetcher(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      ...(signal ? { signal } : {}),
    });
    if (response.status === 416) {
      throw new NdpiFormatError(`The file ends before byte ${offset}`);
    }
    if (response.status !== 206) {
      throw new Error(`The slide answered ${response.status} to a byte range request`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > length ? bytes.slice(0, length) : bytes;
  };
}

async function readFrame(
  read: ByteReader,
  page: NdpiPage,
  signal?: AbortSignal,
): Promise<NdpiFrame> {
  for (const probe of headerProbes) {
    const frame = parseNdpiFrame(
      await read(page.stripOffset, Math.min(probe, page.stripLength), signal),
    );
    if (frame !== null) return frame;
  }
  throw new NdpiFormatError(`Page ${page.ifd} has no JPEG scan in its first bytes`);
}

function pyramidPages(pages: readonly NdpiPage[]): NdpiPage[] {
  const candidates = pages
    .filter(
      (page) =>
        page.compression === jpegCompression &&
        (page.sourceLens === null || page.sourceLens > 0) &&
        page.focalOffset === 0,
    )
    .sort((a, b) => b.width - a.width);
  const pyramid: NdpiPage[] = [];
  for (const page of candidates) {
    const previous = pyramid.at(-1);
    if (previous === undefined || (page.width < previous.width && page.height < previous.height)) {
      pyramid.push(page);
    }
  }
  if (pyramid.length === 0) throw new NdpiFormatError("The NDPI file holds no slide levels");
  return pyramid;
}

function describeLevel(page: NdpiPage, frame: NdpiFrame, downsample: number): NdpiLevel {
  const { width, height } = page;
  const mcuRows = Math.ceil(height / frame.mcuHeight);
  const intervalsPerRow =
    frame.restartInterval > 0 ? Math.ceil(width / frame.mcuWidth) / frame.restartInterval : 0;
  const tiled =
    page.restartCount > 0 &&
    Number.isInteger(intervalsPerRow) &&
    intervalsPerRow >= 1 &&
    page.restartCount === intervalsPerRow * mcuRows;
  const shape = {
    page,
    frame,
    downsample,
    width,
    height,
    tileWidth: ndpiTileSize,
    tileHeight: ndpiTileSize,
    mcuRows,
  };
  if (tiled) {
    const bandRows = Math.max(1, Math.round(ndpiTileSize / frame.mcuHeight));
    const intervalWidth = frame.restartInterval * frame.mcuWidth;
    const unitIntervals = Math.min(
      intervalsPerRow,
      Math.max(1, Math.round(ndpiTileSize / intervalWidth)),
    );
    return {
      ...shape,
      intervalsPerRow,
      unitIntervals,
      unitWidth: unitIntervals * intervalWidth,
      bandRows,
      bandHeight: bandRows * frame.mcuHeight,
      whole: false,
    };
  }
  if (width > 65535 || height > 65535 || width * height > wholeLevelPixels) {
    throw new NdpiFormatError(
      `The ${width} x ${height} NDPI level has no restart index to cut tiles from`,
    );
  }
  return {
    ...shape,
    intervalsPerRow: 1,
    unitIntervals: 1,
    unitWidth: width,
    bandRows: mcuRows,
    bandHeight: height,
    whole: true,
  };
}

async function readMicronsPerPixel(
  read: ByteReader,
  page: NdpiPage,
  signal?: AbortSignal,
): Promise<MicronsPerPixel | null> {
  if (page.xResolutionOffset === null || page.yResolutionOffset === null) return null;
  const [x, y] = await Promise.all([
    readRational(read, page.xResolutionOffset, signal),
    readRational(read, page.yResolutionOffset, signal),
  ]);
  if (x === null || y === null || x <= 0 || y <= 0) return null;
  const unit = page.resolutionUnit === centimetre ? 10000 : 25400;
  return { x: unit / x, y: unit / y };
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const runs: Span[] = [];
  for (const span of spans) {
    const last = runs.at(-1);
    if (last !== undefined && span.start - last.end <= mergeGap) {
      runs[runs.length - 1] = { start: last.start, end: span.end };
    } else {
      runs.push(span);
    }
  }
  return runs;
}

function meanAbsoluteError(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let at = 0; at < a.length; at++) total += Math.abs((a[at] ?? 0) - (b[at] ?? 0));
  return total / a.length;
}

export async function openNdpiSource(request: OpenRequest): Promise<PixelSource> {
  const url = absoluteUrl(request.url, request.baseUrl).href;
  const read = rangeReader(url, request.fetch ?? globalThis.fetch.bind(globalThis));
  const pages = pyramidPages(
    await readNdpiPages(read, request.signal).catch((error: unknown) => {
      throw error instanceof NdpiFormatError ? new UnsupportedFormatError(request.formatId) : error;
    }),
  );
  const [basePage] = pages;
  if (basePage === undefined) throw new NdpiFormatError("The NDPI file holds no slide levels");
  const levels = await Promise.all(
    pages.map(async (page) =>
      describeLevel(
        page,
        await readFrame(read, page, request.signal),
        Math.round(basePage.width / page.width),
      ),
    ),
  );
  const micronsPerPixel =
    request.index?.micronsPerPixel !== undefined
      ? request.index.micronsPerPixel
      : await readMicronsPerPixel(read, basePage, request.signal);

  let closed = false;
  const nativeDecoder =
    request.nativeJpeg === "off"
      ? null
      : typeof request.nativeJpeg === "function"
        ? request.nativeJpeg
        : browserTileDecoder();
  const scriptDecoders = new Map<NdpiLevel, ReturnType<typeof getDecoder>>();
  let decision: Promise<Decision> | null = null;
  let nativeReads = 0;
  let scriptReads = 0;
  let nativeFallbacks = 0;
  const starts = new Map<number, Promise<Float64Array>>();
  const units = new Map<string, Unit>();
  const pending = new Map<string, Promise<Unit>>();
  let cachedBytes = 0;

  const startsOf = (levelIndex: number, level: NdpiLevel): Promise<Float64Array> => {
    let loading = starts.get(levelIndex);
    if (loading === undefined) {
      loading = readRestartStarts(read, level.page);
      starts.set(levelIndex, loading);
      loading.catch(() => starts.delete(levelIndex));
    }
    return loading;
  };

  const decodeScript = async (
    level: NdpiLevel,
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Uint8Array> => {
    let loading = scriptDecoders.get(level);
    if (loading === undefined) {
      loading = getDecoder(jpegCompression, {
        tileWidth: width,
        tileHeight: height,
        predictor: 1,
        bitsPerSample: 8,
        planarConfiguration: 1,
      });
      scriptDecoders.set(level, loading);
    }
    const decoder = await loading;
    const pixels = new Uint8Array(await decoder.decode(jpeg.buffer));
    if (pixels.length !== width * height * 3) {
      throw new NdpiFormatError(`A rebuilt ${width} x ${height} tile decoded to the wrong size`);
    }
    if (!level.frame.storesRgb) ycbcrToRgb(pixels);
    return pixels;
  };

  const decodeNative = async (
    decode: NativeTileDecoder,
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Uint8Array> => {
    const pixels = await decode(jpeg);
    if (pixels.width !== width || pixels.height !== height) {
      throw new NdpiFormatError(
        `The browser decoded ${pixels.width} x ${pixels.height} where ${width} x ${height} was rebuilt`,
      );
    }
    const rgb = new Uint8Array(width * height * 3);
    for (let from = 0, to = 0; to < rgb.length; from += 4, to += 3) {
      rgb[to] = pixels.rgba[from] ?? 0;
      rgb[to + 1] = pixels.rgba[from + 1] ?? 0;
      rgb[to + 2] = pixels.rgba[from + 2] ?? 0;
    }
    return rgb;
  };

  const probe = async (
    level: NdpiLevel,
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Decision> => {
    if (request.nativeJpeg === "off") {
      return { jpeg: "script", reason: "disabled", meanAbsoluteError: null };
    }
    if (nativeDecoder === null) {
      return { jpeg: "script", reason: "unavailable", meanAbsoluteError: null };
    }
    if (request.nativeJpeg === "unvalidated") {
      return { jpeg: "native", reason: "unvalidated", meanAbsoluteError: null };
    }
    try {
      const [native, script] = await Promise.all([
        decodeNative(nativeDecoder, jpeg, width, height),
        decodeScript(level, jpeg, width, height),
      ]);
      const error = meanAbsoluteError(native, script);
      return error <= agreementThreshold
        ? { jpeg: "native", reason: "agreed", meanAbsoluteError: error }
        : { jpeg: "script", reason: "disagreed", meanAbsoluteError: error };
    } catch {
      return { jpeg: "script", reason: "unavailable", meanAbsoluteError: null };
    }
  };

  const decodeUnit = async (
    level: NdpiLevel,
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Uint8Array> => {
    decision ??= probe(level, jpeg, width, height);
    const decided = await decision;
    if (decided.jpeg === "native" && nativeDecoder !== null) {
      try {
        const rgb = await decodeNative(nativeDecoder, jpeg, width, height);
        nativeReads++;
        return rgb;
      } catch (error) {
        if (closed) throw error;
        nativeFallbacks++;
      }
    }
    const rgb = await decodeScript(level, jpeg, width, height);
    scriptReads++;
    return rgb;
  };

  const intervalsOf = async (
    levelIndex: number,
    level: NdpiLevel,
    column: number,
    firstRow: number,
    rows: number,
  ): Promise<Uint8Array[]> => {
    const { page, frame } = level;
    const spans: Span[] = [];
    if (level.whole) {
      spans.push({ start: frame.header.length, end: page.stripLength });
    } else {
      const table = await startsOf(levelIndex, level);
      for (let row = firstRow; row < firstRow + rows; row++) {
        const first = row * level.intervalsPerRow + column * level.unitIntervals;
        const last = Math.min(first + level.unitIntervals, (row + 1) * level.intervalsPerRow);
        for (let index = first; index < last; index++) {
          const start = table[index];
          const next = table[index + 1];
          if (start === undefined) {
            throw new NdpiFormatError(`Restart interval ${index} is missing`);
          }
          spans.push({ start, end: next === undefined ? page.stripLength : next - 2 });
        }
      }
    }
    const runs = mergeSpans(spans);
    const fetched = await Promise.all(
      runs.map(async (run) => {
        const bytes = await read(page.stripOffset + run.start, run.end - run.start);
        if (bytes.length < run.end - run.start) {
          throw new NdpiFormatError("The file ends inside a restart interval");
        }
        return { run, bytes };
      }),
    );
    return spans.map((span, index) => {
      const holder = fetched.find(({ run }) => run.start <= span.start && span.end <= run.end);
      if (holder === undefined) throw new NdpiFormatError("A restart interval was not fetched");
      const bytes = holder.bytes.subarray(
        span.start - holder.run.start,
        span.end - holder.run.start,
      );
      return index === spans.length - 1 ? withoutEndOfImage(bytes) : bytes;
    });
  };

  const remember = (key: string, unit: Unit): void => {
    units.set(key, unit);
    cachedBytes += unit.rgb.length;
    for (const [oldest, held] of units) {
      if (cachedBytes <= ndpiUnitCacheBytes || oldest === key) break;
      units.delete(oldest);
      cachedBytes -= held.rgb.length;
    }
  };

  const loadUnit = (levelIndex: number, column: number, band: number): Promise<Unit> => {
    const key = `${levelIndex}/${column}/${band}`;
    const held = units.get(key);
    if (held !== undefined) {
      units.delete(key);
      units.set(key, held);
      return Promise.resolve(held);
    }
    const running = pending.get(key);
    if (running !== undefined) return running;
    const level = levelAt(levels, levelIndex);
    const loading = (async () => {
      const firstRow = band * level.bandRows;
      const rows = Math.min(level.bandRows, level.mcuRows - firstRow);
      const width = Math.min(level.unitWidth, level.width - column * level.unitWidth);
      const height = Math.min(
        rows * level.frame.mcuHeight,
        level.height - firstRow * level.frame.mcuHeight,
      );
      const intervals = await intervalsOf(levelIndex, level, column, firstRow, rows);
      if (closed) throw new SourceClosedError();
      const jpeg = buildNdpiJpeg(level.frame, width, height, intervals);
      const unit = { width, height, rgb: await decodeUnit(level, jpeg, width, height) };
      if (!closed) remember(key, unit);
      return unit;
    })();
    pending.set(key, loading);
    const forget = () => pending.delete(key);
    loading.then(forget, forget);
    return loading;
  };

  const readWindow = async (
    levelIndex: number,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<PixelResult> => {
    if (closed) throw new SourceClosedError();
    signal?.throwIfAborted();
    const level = levelAt(levels, levelIndex);
    const [x0, y0, x1, y1] = window;
    const width = x1 - x0;
    const height = y1 - y0;
    const planes = [0, 1, 2].map(() => new Uint8Array(width * height));
    const jobs: Promise<void>[] = [];
    for (
      let band = Math.floor(y0 / level.bandHeight);
      band <= Math.floor((y1 - 1) / level.bandHeight);
      band++
    ) {
      for (
        let column = Math.floor(x0 / level.unitWidth);
        column <= Math.floor((x1 - 1) / level.unitWidth);
        column++
      ) {
        const unitLeft = column * level.unitWidth;
        const unitTop = band * level.bandHeight;
        jobs.push(
          loadUnit(levelIndex, column, band).then((unit) => {
            const left = Math.max(x0, unitLeft);
            const top = Math.max(y0, unitTop);
            const right = Math.min(x1, unitLeft + unit.width);
            const bottom = Math.min(y1, unitTop + unit.height);
            for (let y = top; y < bottom; y++) {
              let from = ((y - unitTop) * unit.width + (left - unitLeft)) * 3;
              let to = (y - y0) * width + (left - x0);
              for (let x = left; x < right; x++) {
                for (let channel = 0; channel < 3; channel++) {
                  const plane = planes[channel];
                  if (plane !== undefined) plane[to] = unit.rgb[from + channel] ?? 0;
                }
                from += 3;
                to++;
              }
            }
          }),
        );
      }
    }
    await Promise.all(jobs);
    if (closed) throw new SourceClosedError();
    signal?.throwIfAborted();
    return { absent: false, width, height, planes };
  };

  return {
    formatId: request.formatId,
    levels,
    tileSize: { width: ndpiTileSize, height: ndpiTileSize },
    micronsPerPixel,
    photometric: "rgb",
    dtype: "uint8",
    channels: rgbChannels,
    async getTile(tile: TileRequest) {
      const level = checkTile(levels, tile);
      return readWindow(tile.level, tileWindow(level, tile.x, tile.y), tile.signal);
    },
    async getRaster(raster: RasterRequest) {
      const level = levelAt(levels, raster.level);
      return readWindow(raster.level, checkWindow(level, raster.window), raster.signal);
    },
    async decodeReport(): Promise<DecodeReport> {
      if (decision === null) await loadUnit(levels.length - 1, 0, 0);
      const decided = (await decision) ?? {
        jpeg: "script" as const,
        reason: "unavailable" as const,
        meanAbsoluteError: null,
      };
      return { ...decided, nativeReads, scriptReads, nativeFallbacks };
    },
    close() {
      closed = true;
      units.clear();
      pending.clear();
      cachedBytes = 0;
    },
  };
}
