import { BaseDecoder } from "geotiff";
import { decodeCodestream } from "./openjpeg-runtime.ts";

export const damagedTileGrey = 160;

export class MainThreadCodecError extends Error {
  constructor() {
    super("JPEG 2000 tiles are decoded in the decode workers, never on the main thread");
    this.name = "MainThreadCodecError";
  }
}

let damagedTiles = 0;

export function jpeg2000DamagedTileCount(): number {
  return damagedTiles;
}

function onMainThread(): boolean {
  return "document" in globalThis;
}

export function hasCodestreamHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0x4f &&
    bytes[2] === 0xff &&
    bytes[3] === 0x51
  );
}

function bytesPerSample(bitsPerSample: number | number[] | ArrayLike<number>): number {
  const bits = typeof bitsPerSample === "number" ? bitsPerSample : (bitsPerSample[0] ?? 8);
  return Math.ceil(bits / 8);
}

function greyTile(length: number, sampleBytes: number): ArrayBuffer {
  if (sampleBytes === 1) return new Uint8Array(length).fill(damagedTileGrey).buffer;
  const grey = damagedTileGrey * 257;
  return new Uint16Array(length / 2).fill(grey).buffer;
}

export default class Jpeg2000Decoder extends BaseDecoder {
  override async decodeBlock(buffer: ArrayBufferLike): Promise<ArrayBufferLike> {
    if (onMainThread()) throw new MainThreadCodecError();
    const { tileWidth, tileHeight, bitsPerSample, samplesPerPixel } = this.parameters;
    const sampleBytes = bytesPerSample(bitsPerSample);
    const samples = samplesPerPixel ?? 3;
    const expected = tileWidth * tileHeight * samples * sampleBytes;
    const damaged = (): ArrayBuffer => {
      damagedTiles++;
      return greyTile(expected, sampleBytes);
    };
    const encoded = new Uint8Array(buffer);
    if (!hasCodestreamHeader(encoded)) return damaged();
    let decoded: Awaited<ReturnType<typeof decodeCodestream>>;
    try {
      decoded = await decodeCodestream(encoded);
    } catch {
      return damaged();
    }
    const intact =
      decoded.width === tileWidth &&
      decoded.height === tileHeight &&
      decoded.componentCount === samples &&
      decoded.samples.length === expected;
    return intact ? decoded.samples.buffer : damaged();
  }
}
