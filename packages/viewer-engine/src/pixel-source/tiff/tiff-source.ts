import type { GeoTIFFImage } from "geotiff";
import { checkTile, checkWindow, levelAt, recoverLadder, tileWindow } from "../geometry.ts";
import {
  type ChannelInfo,
  type DecodeReport,
  type JpegDecoderChoice,
  type JpegDecoderReason,
  type NativeTileDecoder,
  type OpenRequest,
  type Photometric,
  type PixelArray,
  type PixelDtype,
  type PixelLevel,
  type PixelResult,
  type PixelSource,
  type PixelWindow,
  type RasterRequest,
  SourceClosedError,
  type TileRequest,
} from "../types.ts";
import { absoluteUrl } from "../url.ts";
import {
  assertDecodable,
  largestPyramid,
  listPages,
  loadByteCounts,
  loadTag,
  openTiff,
  type TiffPage,
} from "./directory.ts";
import {
  browserTileDecoder,
  chooseProbeTile,
  describeJpegTiles,
  type JpegTileLayout,
  meanAbsoluteError,
  type NativeLevel,
  nativeAgreementThreshold,
  readWindowNatively,
} from "./native-jpeg.ts";
import { parseOmeChannels } from "./ome-channels.ts";
import { readMicronsPerPixel } from "./scale.ts";

const photometricCodes = {
  whiteIsZero: 0,
  blackIsZero: 1,
  rgb: 2,
  palette: 3,
  cmyk: 5,
  ycbcr: 6,
  cieLab: 8,
} as const;

const convertedToRgb = new Set<number>([
  photometricCodes.whiteIsZero,
  photometricCodes.palette,
  photometricCodes.cmyk,
  photometricCodes.ycbcr,
  photometricCodes.cieLab,
]);

type Decode = "rgb-transform" | "samples";

interface TiffLevel extends PixelLevel {
  readonly page: TiffPage;
  readonly image: GeoTIFFImage;
  readonly siblings: readonly GeoTIFFImage[];
  readonly byteCounts: ArrayLike<number> | null;
  readonly jpeg: JpegTileLayout | null;
}

interface JpegDecision {
  readonly jpeg: JpegDecoderChoice;
  readonly reason: JpegDecoderReason;
  readonly meanAbsoluteError: number | null;
}

interface Layout {
  readonly decode: Decode;
  readonly samples: readonly number[];
  readonly photometric: Photometric;
  readonly dtype: PixelDtype;
  readonly channels: readonly ChannelInfo[];
  readonly background: number;
}

const rgbChannels: readonly ChannelInfo[] = [
  { name: "Red", color: [255, 0, 0], window: null },
  { name: "Green", color: [0, 255, 0], window: null },
  { name: "Blue", color: [0, 0, 255], window: null },
];

function dtypeOf(image: GeoTIFFImage): PixelDtype {
  const bits = image.getBitsPerSample(0);
  const format = image.getSampleFormat(0);
  const integer: Record<number, PixelDtype> = { 8: "uint8", 16: "uint16", 32: "uint32" };
  const signed: Record<number, PixelDtype> = { 8: "int8", 16: "int16", 32: "int32" };
  const float: Record<number, PixelDtype> = { 32: "float32", 64: "float64" };
  const table = format === 2 ? signed : format === 3 ? float : integer;
  const dtype = table[bits];
  if (dtype === undefined)
    throw new Error(`Unsupported sample type: ${bits} bits, format ${format}`);
  return dtype;
}

function layoutOf(image: GeoTIFFImage): Layout {
  const photometric = Number(image.fileDirectory.getValue("PhotometricInterpretation") ?? 1);
  const samplesPerPixel = image.getSamplesPerPixel();
  const dtype = dtypeOf(image);
  if (photometric === photometricCodes.rgb && samplesPerPixel >= 3) {
    return {
      decode: "samples",
      samples: [0, 1, 2],
      photometric: "rgb",
      dtype,
      channels: rgbChannels,
      background: dtype === "uint8" ? 255 : 0,
    };
  }
  if (convertedToRgb.has(photometric) && dtype === "uint8") {
    return {
      decode: "rgb-transform",
      samples: [0, 1, 2],
      photometric: "rgb",
      dtype: "uint8",
      channels: rgbChannels,
      background: 255,
    };
  }
  if (photometric === photometricCodes.blackIsZero) {
    const samples = Array.from({ length: samplesPerPixel }, (_, index) => index);
    const grey = samplesPerPixel === 1;
    return {
      decode: "samples",
      samples,
      photometric: grey ? "grey" : "channels",
      dtype,
      channels: samples.map((index) => ({
        name: grey ? "Grey" : `Channel ${index + 1}`,
        color: null,
        window: null,
      })),
      background: 0,
    };
  }
  throw new Error(`Unsupported photometric interpretation ${photometric} with ${dtype} samples`);
}

async function chooseLevels(
  pages: readonly TiffPage[],
  request: OpenRequest,
): Promise<TiffLevel[]> {
  const indexed = request.index?.levels;
  if (indexed !== undefined && indexed.length > 0) {
    return Promise.all(
      indexed.map(async (level) => {
        const page = pages.find(
          (candidate) => candidate.ifd === level.page && candidate.subIfd === null,
        );
        if (page === undefined)
          throw new Error(`The slide index names page ${level.page}, which the file lacks`);
        return describe(page, level.downsample, level.width, level.height);
      }),
    );
  }
  const pyramid = largestPyramid(pages);
  if (pyramid.length === 0) throw new Error("The TIFF holds no tiled pyramid");
  const steps = recoverLadder(
    pyramid.map((page) => ({
      width: page.image.getWidth(),
      height: page.image.getHeight(),
      tileWidth: page.image.getTileWidth(),
      tileHeight: page.image.getTileHeight(),
    })),
  );
  return Promise.all(
    steps.map((step) => {
      const page = pyramid[step.stored];
      if (page === undefined) throw new Error(`Missing pyramid page ${step.stored}`);
      return describe(page, step.downsample, step.width, step.height);
    }),
  );
}

async function describe(
  page: TiffPage,
  downsample: number,
  width: number,
  height: number,
): Promise<TiffLevel> {
  return {
    page,
    image: page.image,
    siblings: [],
    byteCounts: await loadByteCounts(page.image),
    jpeg: await describeJpegTiles(page.image),
    downsample,
    width,
    height,
    tileWidth: page.image.getTileWidth(),
    tileHeight: page.image.getTileHeight(),
  };
}

function storedTiles(level: TiffLevel, window: PixelWindow): number[] {
  const columns = Math.ceil(level.image.getWidth() / level.tileWidth);
  const [x0, y0, x1, y1] = window;
  const indices: number[] = [];
  for (
    let row = Math.floor(y0 / level.tileHeight);
    row <= Math.floor((y1 - 1) / level.tileHeight);
    row++
  ) {
    for (
      let column = Math.floor(x0 / level.tileWidth);
      column <= Math.floor((x1 - 1) / level.tileWidth);
      column++
    ) {
      indices.push(row * columns + column);
    }
  }
  return indices;
}

function isAbsent(level: TiffLevel, index: number): boolean {
  const counts = level.byteCounts;
  return counts !== null && index < counts.length && Number(counts[index]) === 0;
}

function paintAbsent(
  level: TiffLevel,
  window: PixelWindow,
  planes: readonly PixelArray[],
  background: number,
): void {
  const columns = Math.ceil(level.image.getWidth() / level.tileWidth);
  const [x0, y0, x1, y1] = window;
  const width = x1 - x0;
  for (const index of storedTiles(level, window)) {
    if (!isAbsent(level, index)) continue;
    const tileLeft = (index % columns) * level.tileWidth;
    const tileTop = Math.floor(index / columns) * level.tileHeight;
    const left = Math.max(x0, tileLeft);
    const top = Math.max(y0, tileTop);
    const right = Math.min(x1, tileLeft + level.tileWidth);
    const bottom = Math.min(y1, tileTop + level.tileHeight);
    for (const plane of planes) {
      for (let y = top; y < bottom; y++) {
        const start = (y - y0) * width + (left - x0);
        plane.fill(background, start, start + (right - left));
      }
    }
  }
}

function withChannelPages(
  levels: readonly TiffLevel[],
  pages: readonly TiffPage[],
  channelCount: number,
): TiffLevel[] | null {
  const withSiblings: TiffLevel[] = [];
  for (const level of levels) {
    const siblings: GeoTIFFImage[] = [];
    for (let channel = 1; channel < channelCount; channel++) {
      const sibling = pages.find(
        (page) =>
          page.ifd === level.page.ifd + channel &&
          page.subIfd === level.page.subIfd &&
          page.image.getWidth() === level.image.getWidth() &&
          page.image.getHeight() === level.image.getHeight() &&
          page.image.getSamplesPerPixel() === 1,
      );
      if (sibling === undefined) return null;
      siblings.push(sibling.image);
    }
    withSiblings.push({ ...level, siblings });
  }
  return withSiblings;
}

async function omeChannelLevels(
  levels: TiffLevel[],
  pages: readonly TiffPage[],
): Promise<{ levels: TiffLevel[]; channels: readonly ChannelInfo[] } | null> {
  const [first] = levels;
  if (first === undefined || first.image.getSamplesPerPixel() !== 1) return null;
  const description = await loadTag(first.image, "ImageDescription");
  const channels = typeof description === "string" ? parseOmeChannels(description) : null;
  if (channels === null) return null;
  const withSiblings = withChannelPages(levels, pages, channels.length);
  return withSiblings === null ? null : { levels: withSiblings, channels };
}

export async function openTiffSource(request: OpenRequest): Promise<PixelSource> {
  const tiff = await openTiff(
    absoluteUrl(request.url, request.baseUrl),
    request.signal,
    request.fetch,
  );
  const pages = await listPages(tiff);
  const plainLevels = await chooseLevels(pages, request);
  const multichannel = await omeChannelLevels(plainLevels, pages);
  const levels = multichannel?.levels ?? plainLevels;
  const base = levelAt(levels, 0);
  await assertDecodable(base.image);
  const singleLayout = layoutOf(base.image);
  const layout: Layout =
    multichannel === null
      ? singleLayout
      : {
          decode: "samples",
          samples: [0],
          photometric: "channels",
          dtype: singleLayout.dtype,
          channels: multichannel.channels,
          background: 0,
        };
  const micronsPerPixel =
    request.index?.micronsPerPixel !== undefined
      ? request.index.micronsPerPixel
      : await readMicronsPerPixel(base.image);
  let closed = false;
  const nativeDecoder =
    request.nativeJpeg === "off"
      ? null
      : typeof request.nativeJpeg === "function"
        ? request.nativeJpeg
        : browserTileDecoder();
  const nativeCapable = layout.photometric === "rgb" && layout.dtype === "uint8";
  const nativeLevels = levels.map((level) => nativeCapable && level.jpeg !== null);
  let nativeReads = 0;
  let scriptReads = 0;
  let nativeFallbacks = 0;

  const scriptPlanes = async (
    level: TiffLevel,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<PixelArray[]> => {
    const options = {
      window: [...window],
      interleave: false as const,
      ...(signal ? { signal } : {}),
    };
    if (level.siblings.length > 0) {
      const perChannel = await Promise.all(
        [level.image, ...level.siblings].map((image) =>
          image.readRasters({ ...options, samples: [0] }),
        ),
      );
      return perChannel.flatMap((planes) => Array.from(planes as ArrayLike<PixelArray>));
    }
    const decoded =
      layout.decode === "rgb-transform"
        ? await level.image.readRGB(options)
        : await level.image.readRasters({ ...options, samples: [...layout.samples] });
    return Array.from(decoded as ArrayLike<PixelArray>);
  };

  const nativeViewOf = (level: TiffLevel): NativeLevel | null =>
    level.jpeg === null
      ? null
      : {
          image: level.image,
          tileWidth: level.tileWidth,
          tileHeight: level.tileHeight,
          layout: level.jpeg,
          isAbsent: (index) => isAbsent(level, index),
        };

  const nativePlanes = (
    decode: NativeTileDecoder,
    level: TiffLevel,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<PixelArray[]> => {
    const view = nativeViewOf(level);
    if (view === null) throw new Error("The level holds no JPEG tiles");
    return readWindowNatively(view, decode, window, layout.background, signal);
  };

  const probeFile = async (): Promise<JpegDecision> => {
    if (!nativeLevels.some(Boolean))
      return { jpeg: "none", reason: "not-jpeg", meanAbsoluteError: null };
    if (request.nativeJpeg === "off") {
      return { jpeg: "script", reason: "disabled", meanAbsoluteError: null };
    }
    if (nativeDecoder === null) {
      return { jpeg: "script", reason: "unavailable", meanAbsoluteError: null };
    }
    if (request.nativeJpeg === "unvalidated") {
      return { jpeg: "native", reason: "unvalidated", meanAbsoluteError: null };
    }
    const probed = new Set<string>();
    let worst = 0;
    for (const [at, level] of levels.entries()) {
      const key = level.jpeg?.tablesKey;
      if (!nativeLevels[at] || key === undefined || probed.has(key)) continue;
      const tile = chooseProbeTile(
        level.width,
        level.height,
        level.tileWidth,
        level.tileHeight,
        level.image.getWidth(),
        level.byteCounts,
        (index) => isAbsent(level, index),
      );
      if (tile === null) continue;
      probed.add(key);
      try {
        const [native, reference] = await Promise.all([
          nativePlanes(nativeDecoder, level, tile.window),
          scriptPlanes(level, tile.window),
        ]);
        worst = Math.max(worst, meanAbsoluteError(native, reference));
      } catch {
        return { jpeg: "script", reason: "unavailable", meanAbsoluteError: null };
      }
    }
    const keys = new Set(
      levels.flatMap((level, at) => (nativeLevels[at] && level.jpeg ? [level.jpeg.tablesKey] : [])),
    );
    if (probed.size < keys.size) {
      return { jpeg: "script", reason: "no-probe-tile", meanAbsoluteError: null };
    }
    return worst <= nativeAgreementThreshold
      ? { jpeg: "native", reason: "agreed", meanAbsoluteError: worst }
      : { jpeg: "script", reason: "disagreed", meanAbsoluteError: worst };
  };

  let decision: Promise<JpegDecision> | null = null;
  const decide = (): Promise<JpegDecision> => {
    decision ??= probeFile();
    return decision;
  };

  const read = async (
    levelIndex: number,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<PixelResult> => {
    if (closed) throw new SourceClosedError();
    signal?.throwIfAborted();
    const level = levelAt(levels, levelIndex);
    const width = window[2] - window[0];
    const height = window[3] - window[1];
    const tiles = storedTiles(level, window);
    if (tiles.every((index) => isAbsent(level, index))) return { absent: true, width, height };
    let planes: PixelArray[] | null = null;
    if (nativeLevels[levelIndex] && nativeDecoder !== null && (await decide()).jpeg === "native") {
      try {
        planes = await nativePlanes(nativeDecoder, level, window, signal);
        nativeReads++;
      } catch (error) {
        if (closed || signal?.aborted) throw error;
        nativeFallbacks++;
      }
    }
    if (planes === null) {
      planes = await scriptPlanes(level, window, signal);
      scriptReads++;
    }
    paintAbsent(level, window, planes, layout.background);
    return { absent: false, width, height, planes };
  };

  return {
    formatId: request.formatId,
    levels,
    tileSize: { width: base.tileWidth, height: base.tileHeight },
    micronsPerPixel,
    photometric: layout.photometric,
    dtype: layout.dtype,
    channels: layout.channels,
    async getTile(tile: TileRequest) {
      const level = checkTile(levels, tile);
      return read(tile.level, tileWindow(level, tile.x, tile.y), tile.signal);
    },
    async getRaster(raster: RasterRequest) {
      const level = levelAt(levels, raster.level);
      return read(raster.level, checkWindow(level, raster.window), raster.signal);
    },
    async decodeReport(): Promise<DecodeReport> {
      const decided = await decide();
      return { ...decided, nativeReads, scriptReads, nativeFallbacks };
    },
    close() {
      closed = true;
    },
  };
}
