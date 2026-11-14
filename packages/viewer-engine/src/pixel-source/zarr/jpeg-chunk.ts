import { getDecoder } from "geotiff";
import * as zarr from "zarrita";
import { NdpiFormatError } from "../ndpi/directory.ts";
import { parseNdpiFrame, ycbcrToRgb } from "../ndpi/jpeg.ts";
import {
  browserTileDecoder,
  jpegCompression,
  meanAbsoluteError,
  nativeAgreementThreshold,
} from "../tiff/native-jpeg.ts";
import type {
  DecodeReport,
  JpegDecoderChoice,
  JpegDecoderReason,
  NativeTileDecoder,
  OpenRequest,
} from "../types.ts";

export const jpegChunkCodecId = "imagecodecs_jpeg";

const samples = 3;

export class JpegChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JpegChunkError";
  }
}

interface Decision {
  readonly jpeg: JpegDecoderChoice;
  readonly reason: JpegDecoderReason;
  readonly meanAbsoluteError: number | null;
}

export interface JpegChunkDecoding {
  readonly token: string;
  decode(jpeg: Uint8Array<ArrayBuffer>, width: number, height: number): Promise<Uint8Array>;
  report(): Promise<DecodeReport | null>;
  release(): void;
}

function planar(pixels: ArrayLike<number>, stride: number, count: number): Uint8Array {
  const planes = new Uint8Array(count * samples);
  for (let sample = 0; sample < samples; sample++) {
    const start = sample * count;
    for (let at = 0, from = sample; at < count; at++, from += stride) {
      planes[start + at] = pixels[from] ?? 0;
    }
  }
  return planes;
}

function planesOf(planes: Uint8Array): Uint8Array[] {
  const count = planes.length / samples;
  return [0, 1, 2].map((sample) => planes.subarray(sample * count, (sample + 1) * count));
}

function storesRgb(jpeg: Uint8Array): boolean {
  try {
    const frame = parseNdpiFrame(jpeg);
    if (frame === null) throw new JpegChunkError("The JPEG chunk has no scan");
    return frame.storesRgb;
  } catch (error) {
    if (error instanceof NdpiFormatError) {
      throw new JpegChunkError("Only baseline 8-bit three-component JPEG chunks are read");
    }
    throw error;
  }
}

const contexts = new Map<string, JpegChunkDecoding>();

let issued = 0;

export function createJpegChunkDecoding(choice: OpenRequest["nativeJpeg"]): JpegChunkDecoding {
  const token = `jpeg-chunks-${++issued}`;
  const nativeDecoder: NativeTileDecoder | null =
    choice === "off" ? null : typeof choice === "function" ? choice : browserTileDecoder();
  const scriptDecoders = new Map<string, ReturnType<typeof getDecoder>>();
  let decision: Promise<Decision> | null = null;
  let nativeReads = 0;
  let scriptReads = 0;
  let nativeFallbacks = 0;

  const decodeScript = async (
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Uint8Array> => {
    const rgb = storesRgb(jpeg);
    const key = `${width}x${height}`;
    let loading = scriptDecoders.get(key);
    if (loading === undefined) {
      loading = getDecoder(jpegCompression, {
        tileWidth: width,
        tileHeight: height,
        predictor: 1,
        bitsPerSample: 8,
        planarConfiguration: 1,
      });
      scriptDecoders.set(key, loading);
    }
    const decoder = await loading;
    const pixels = new Uint8Array(await decoder.decode(jpeg.buffer));
    if (pixels.length !== width * height * samples) {
      throw new JpegChunkError(`A JPEG chunk did not decode to ${width} x ${height} RGB`);
    }
    if (!rgb) ycbcrToRgb(pixels);
    return planar(pixels, samples, width * height);
  };

  const decodeNative = async (
    decode: NativeTileDecoder,
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Uint8Array> => {
    const pixels = await decode(jpeg);
    if (pixels.width !== width || pixels.height !== height) {
      throw new JpegChunkError(
        `The browser decoded ${pixels.width} x ${pixels.height} where the chunk is ${width} x ${height}`,
      );
    }
    return planar(pixels.rgba, 4, width * height);
  };

  const probe = async (
    jpeg: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Decision> => {
    if (choice === "off") return { jpeg: "script", reason: "disabled", meanAbsoluteError: null };
    if (nativeDecoder === null) {
      return { jpeg: "script", reason: "unavailable", meanAbsoluteError: null };
    }
    if (choice === "unvalidated") {
      return { jpeg: "native", reason: "unvalidated", meanAbsoluteError: null };
    }
    try {
      const [native, script] = await Promise.all([
        decodeNative(nativeDecoder, jpeg, width, height),
        decodeScript(jpeg, width, height),
      ]);
      const error = meanAbsoluteError(planesOf(native), planesOf(script));
      return error <= nativeAgreementThreshold
        ? { jpeg: "native", reason: "agreed", meanAbsoluteError: error }
        : { jpeg: "script", reason: "disagreed", meanAbsoluteError: error };
    } catch {
      return { jpeg: "script", reason: "unavailable", meanAbsoluteError: null };
    }
  };

  const context: JpegChunkDecoding = {
    token,
    async decode(jpeg, width, height) {
      decision ??= probe(jpeg, width, height);
      const decided = await decision;
      if (decided.jpeg === "native" && nativeDecoder !== null) {
        try {
          const planes = await decodeNative(nativeDecoder, jpeg, width, height);
          nativeReads++;
          return planes;
        } catch {
          nativeFallbacks++;
        }
      }
      const planes = await decodeScript(jpeg, width, height);
      scriptReads++;
      return planes;
    },
    async report() {
      if (decision === null) return null;
      return { ...(await decision), nativeReads, scriptReads, nativeFallbacks };
    },
    release() {
      contexts.delete(token);
    },
  };
  contexts.set(token, context);
  return context;
}

let shared: JpegChunkDecoding | null = null;

function contextFor(token: unknown): JpegChunkDecoding {
  const context = typeof token === "string" ? contexts.get(token) : undefined;
  if (context !== undefined) return context;
  shared ??= createJpegChunkDecoding(undefined);
  return shared;
}

interface ChunkShape {
  readonly dataType: unknown;
  readonly shape: readonly number[];
}

class JpegChunkCodec {
  readonly kind = "bytes_to_bytes" as const;
  readonly #decoding: JpegChunkDecoding;
  readonly #width: number;
  readonly #height: number;

  constructor(decoding: JpegChunkDecoding, width: number, height: number) {
    this.#decoding = decoding;
    this.#width = width;
    this.#height = height;
  }

  static fromConfig(configuration: unknown, meta: ChunkShape): JpegChunkCodec {
    const { shape } = meta;
    const width = shape.at(-1) ?? 0;
    const height = shape.at(-2) ?? 0;
    const count = shape.reduce((product, size) => product * size, 1);
    if (meta.dataType !== "uint8" || shape.length < 3 || count !== width * height * samples) {
      throw new JpegChunkError(
        `JPEG chunks hold three 8-bit channels, not ${String(meta.dataType)} chunks of ${shape.join(" x ")}`,
      );
    }
    const token = (configuration as { decoder?: unknown } | null | undefined)?.decoder;
    return new JpegChunkCodec(contextFor(token), width, height);
  }

  encode(): never {
    throw new JpegChunkError("JPEG chunks are written by the conversion worker");
  }

  decode(bytes: Uint8Array): Promise<Uint8Array> {
    return this.#decoding.decode(Uint8Array.from(bytes), this.#width, this.#height);
  }
}

const entry = () => Promise.resolve(JpegChunkCodec);

zarr.registry.set(jpegChunkCodecId, entry);
zarr.registry.set(`numcodecs.${jpegChunkCodecId}`, entry);

function tagged(value: unknown, token: string): boolean {
  if (Array.isArray(value)) {
    return value.map((item) => tagged(item, token)).some(Boolean);
  }
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  let found = Object.values(node)
    .map((item) => tagged(item, token))
    .some(Boolean);
  if (node.id === jpegChunkCodecId) {
    node.decoder = token;
    found = true;
  }
  if (node.name === jpegChunkCodecId || node.name === `numcodecs.${jpegChunkCodecId}`) {
    node.configuration = { ...(node.configuration as object | undefined), decoder: token };
    found = true;
  }
  return found;
}

export function tagJpegChunks(metadata: Uint8Array, token: string): Uint8Array | null {
  const text = new TextDecoder().decode(metadata);
  if (!text.includes(jpegChunkCodecId)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return tagged(parsed, token) ? new TextEncoder().encode(JSON.stringify(parsed)) : null;
}
