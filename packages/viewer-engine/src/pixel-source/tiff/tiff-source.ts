import type { GeoTIFF, GeoTIFFImage } from "geotiff";
import { checkTile, checkWindow, levelAt, recoverLadder, tileWindow } from "../geometry.ts";
import {
  type ChannelInfo,
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
  openTiff,
  type TiffPage,
} from "./directory.ts";
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
  readonly image: GeoTIFFImage;
  readonly byteCounts: ArrayLike<number> | null;
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

async function chooseLevels(tiff: GeoTIFF, request: OpenRequest): Promise<TiffLevel[]> {
  const pages = await listPages(tiff);
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
    image: page.image,
    byteCounts: await loadByteCounts(page.image),
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

export async function openTiffSource(request: OpenRequest): Promise<PixelSource> {
  const tiff = await openTiff(absoluteUrl(request.url, request.baseUrl), request.signal);
  const levels = await chooseLevels(tiff, request);
  const base = levelAt(levels, 0);
  await assertDecodable(base.image);
  const layout = layoutOf(base.image);
  const micronsPerPixel =
    request.index?.micronsPerPixel !== undefined
      ? request.index.micronsPerPixel
      : await readMicronsPerPixel(base.image);
  let closed = false;

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
    const options = {
      window: [...window],
      interleave: false as const,
      ...(signal ? { signal } : {}),
    };
    const decoded =
      layout.decode === "rgb-transform"
        ? await level.image.readRGB(options)
        : await level.image.readRasters({ ...options, samples: [...layout.samples] });
    const planes = Array.from(decoded as ArrayLike<PixelArray>);
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
    close() {
      closed = true;
    },
  };
}
