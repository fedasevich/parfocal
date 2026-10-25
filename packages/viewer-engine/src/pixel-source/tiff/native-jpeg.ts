import type { GeoTIFFImage } from "geotiff";
import type { NativeTileDecoder, PixelWindow } from "../types.ts";
import { loadTag } from "./directory.ts";

export const jpegCompression = 7;

export const nativeAgreementThreshold = 3;

const probeCandidates = 24;

const startOfImage = [0xff, 0xd8] as const;

const endOfImage = [0xff, 0xd9] as const;

export interface JpegTileLayout {
  readonly tablesKey: string;
  readonly prefix: Uint8Array | null;
}

export interface NativeLevel {
  readonly image: GeoTIFFImage;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly layout: JpegTileLayout;
  isAbsent(index: number): boolean;
}

export class NativeTileMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`The browser decoded a ${actual} tile where the file stores ${expected}`);
    this.name = "NativeTileMismatchError";
  }
}

function endsWith(bytes: Uint8Array, marker: readonly [number, number]): boolean {
  return bytes.length >= 2 && bytes.at(-2) === marker[0] && bytes.at(-1) === marker[1];
}

function startsWith(bytes: Uint8Array, marker: readonly [number, number]): boolean {
  return bytes.length >= 2 && bytes[0] === marker[0] && bytes[1] === marker[1];
}

export async function describeJpegTiles(image: GeoTIFFImage): Promise<JpegTileLayout | null> {
  if (Number(image.fileDirectory.getValue("Compression")) !== jpegCompression) return null;
  if (!image.isTiled || image.planarConfiguration !== 1) return null;
  if (image.getSamplesPerPixel() !== 3 || image.getBitsPerSample(0) !== 8) return null;
  const tables = (await loadTag(image, "JPEGTables")) as ArrayLike<number> | undefined;
  if (tables === undefined || tables.length === 0) return { tablesKey: "none", prefix: null };
  const bytes = Uint8Array.from(tables);
  const prefix = endsWith(bytes, endOfImage) ? bytes.subarray(0, bytes.length - 2) : bytes;
  return { tablesKey: Array.from(bytes).join(","), prefix };
}

export function assembleJpeg(layout: JpegTileLayout, tile: Uint8Array): Uint8Array<ArrayBuffer> {
  const { prefix } = layout;
  if (prefix === null) return Uint8Array.from(tile);
  const body = startsWith(tile, startOfImage) ? tile.subarray(2) : tile;
  const jpeg = new Uint8Array(prefix.length + body.length);
  jpeg.set(prefix, 0);
  jpeg.set(body, prefix.length);
  return jpeg;
}

export function browserTileDecoder(): NativeTileDecoder | null {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  const surfaces = new Map<string, OffscreenCanvasRenderingContext2D>();
  const contextFor = (width: number, height: number): OffscreenCanvasRenderingContext2D => {
    const key = `${width}x${height}`;
    let context = surfaces.get(key);
    if (context === undefined) {
      const created = new OffscreenCanvas(width, height).getContext("2d", {
        willReadFrequently: true,
      });
      if (created === null) throw new Error("This context has no 2D canvas for JPEG decoding");
      context = created;
      surfaces.set(key, context);
    }
    return context;
  };
  return async (jpeg) => {
    const bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const { width, height } = bitmap;
    const context = contextFor(width, height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { width, height, rgba: context.getImageData(0, 0, width, height).data };
  };
}

export async function readWindowNatively(
  level: NativeLevel,
  decode: NativeTileDecoder,
  window: PixelWindow,
  background: number,
  signal?: AbortSignal,
): Promise<Uint8Array[]> {
  const [x0, y0, x1, y1] = window;
  const width = x1 - x0;
  const height = y1 - y0;
  const planes = [0, 1, 2].map(() => new Uint8Array(width * height).fill(background));
  const { image, tileWidth, tileHeight } = level;
  const columns = Math.ceil(image.getWidth() / tileWidth);
  const jobs: Promise<void>[] = [];
  for (let row = Math.floor(y0 / tileHeight); row <= Math.floor((y1 - 1) / tileHeight); row++) {
    for (
      let column = Math.floor(x0 / tileWidth);
      column <= Math.floor((x1 - 1) / tileWidth);
      column++
    ) {
      const index = row * columns + column;
      if (level.isAbsent(index)) continue;
      jobs.push(
        paintTile(
          level,
          decode,
          index,
          column * tileWidth,
          row * tileHeight,
          window,
          planes,
          signal,
        ),
      );
    }
  }
  await Promise.all(jobs);
  return planes;
}

async function paintTile(
  level: NativeLevel,
  decode: NativeTileDecoder,
  index: number,
  tileLeft: number,
  tileTop: number,
  window: PixelWindow,
  planes: readonly Uint8Array[],
  signal: AbortSignal | undefined,
): Promise<void> {
  const { image, tileWidth, tileHeight, layout } = level;
  const offset = Number(await image.fileDirectory.loadValueIndexed("TileOffsets", index));
  const length = Number(await image.fileDirectory.loadValueIndexed("TileByteCounts", index));
  const [slice] = await image.source.fetch([{ offset, length }], signal);
  if (slice === undefined) throw new Error(`The file returned no bytes for tile ${index}`);
  const pixels = await decode(assembleJpeg(layout, new Uint8Array(slice)));
  signal?.throwIfAborted();
  if (pixels.width !== tileWidth || pixels.height !== tileHeight) {
    throw new NativeTileMismatchError(
      `${tileWidth}x${tileHeight}`,
      `${pixels.width}x${pixels.height}`,
    );
  }
  const [x0, y0, x1, y1] = window;
  const width = x1 - x0;
  const left = Math.max(x0, tileLeft);
  const top = Math.max(y0, tileTop);
  const right = Math.min(x1, tileLeft + tileWidth);
  const bottom = Math.min(y1, tileTop + tileHeight);
  const [red, green, blue] = planes;
  if (red === undefined || green === undefined || blue === undefined) return;
  for (let y = top; y < bottom; y++) {
    let source = ((y - tileTop) * tileWidth + (left - tileLeft)) * 4;
    let target = (y - y0) * width + (left - x0);
    for (let x = left; x < right; x++) {
      red[target] = pixels.rgba[source] ?? 0;
      green[target] = pixels.rgba[source + 1] ?? 0;
      blue[target] = pixels.rgba[source + 2] ?? 0;
      source += 4;
      target++;
    }
  }
}

export interface ProbeTile {
  readonly index: number;
  readonly window: PixelWindow;
}

export function chooseProbeTile(
  levelWidth: number,
  levelHeight: number,
  tileWidth: number,
  tileHeight: number,
  storedWidth: number,
  byteCounts: ArrayLike<number> | null,
  isAbsent: (index: number) => boolean,
): ProbeTile | null {
  const columns = Math.ceil(storedWidth / tileWidth);
  const wholeColumns = Math.floor(levelWidth / tileWidth);
  const wholeRows = Math.floor(levelHeight / tileHeight);
  const present: number[] = [];
  for (let row = 0; row < wholeRows; row++) {
    for (let column = 0; column < wholeColumns; column++) {
      const index = row * columns + column;
      if (!isAbsent(index)) present.push(index);
    }
  }
  if (present.length === 0) return null;
  const stride = Math.max(1, Math.floor(present.length / probeCandidates));
  let best = present[Math.floor(present.length / 2)] ?? 0;
  if (byteCounts !== null) {
    let bestSize = -1;
    for (let at = 0; at < present.length; at += stride) {
      const index = present[at] ?? 0;
      const size = Number(byteCounts[index] ?? 0);
      if (size > bestSize) {
        bestSize = size;
        best = index;
      }
    }
  }
  const x0 = (best % columns) * tileWidth;
  const y0 = Math.floor(best / columns) * tileHeight;
  return { index: best, window: [x0, y0, x0 + tileWidth, y0 + tileHeight] };
}

export function meanAbsoluteError(
  native: readonly ArrayLike<number>[],
  reference: readonly ArrayLike<number>[],
): number {
  let total = 0;
  let count = 0;
  for (let channel = 0; channel < 3; channel++) {
    const a = native[channel];
    const b = reference[channel];
    if (a === undefined || b === undefined || a.length !== b.length)
      return Number.POSITIVE_INFINITY;
    for (let at = 0; at < a.length; at++) {
      total += Math.abs((a[at] ?? 0) - (b[at] ?? 0));
      count++;
    }
  }
  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}
