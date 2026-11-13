import { NdpiFormatError } from "./directory.ts";

export interface NdpiFrame {
  readonly header: Uint8Array<ArrayBuffer>;
  readonly sizeOffset: number;
  readonly mcuWidth: number;
  readonly mcuHeight: number;
  readonly restartInterval: number;
  readonly storesRgb: boolean;
}

const markers = {
  startOfImage: 0xd8,
  endOfImage: 0xd9,
  startOfScan: 0xda,
  restartInterval: 0xdd,
  baselineFrame: 0xc0,
  extendedFrame: 0xc1,
  adobe: 0xee,
  firstRestart: 0xd0,
} as const;

const adobeName = [0x41, 0x64, 0x6f, 0x62, 0x65] as const;

export function parseNdpiFrame(bytes: Uint8Array): NdpiFrame | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== markers.startOfImage) {
    throw new NdpiFormatError("The level does not start with a JPEG image");
  }
  let at = 2;
  let sizeOffset = -1;
  let mcuWidth = 0;
  let mcuHeight = 0;
  let restartInterval = 0;
  let adobeTransform: number | null = null;
  let componentIds: number[] = [];
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new NdpiFormatError("The JPEG header holds a broken segment");
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const end = at + 2 + length;
    if (end > bytes.length) return null;
    if (marker === markers.baselineFrame || marker === markers.extendedFrame) {
      const components = bytes[at + 9] ?? 0;
      if (bytes[at + 4] !== 8 || components !== 3) {
        throw new NdpiFormatError("Only 8-bit three-component NDPI levels are read");
      }
      let maxH = 1;
      let maxV = 1;
      componentIds = [];
      for (let index = 0; index < components; index++) {
        const base = at + 10 + index * 3;
        const sampling = bytes[base + 1] ?? 0x11;
        componentIds.push(bytes[base] ?? 0);
        maxH = Math.max(maxH, sampling >> 4);
        maxV = Math.max(maxV, sampling & 15);
      }
      sizeOffset = at + 5;
      mcuWidth = 8 * maxH;
      mcuHeight = 8 * maxV;
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
      throw new NdpiFormatError("Only baseline JPEG NDPI levels are read");
    } else if (marker === markers.restartInterval) {
      restartInterval = ((bytes[at + 4] ?? 0) << 8) | (bytes[at + 5] ?? 0);
    } else if (
      marker === markers.adobe &&
      length >= 14 &&
      adobeName.every((byte, index) => bytes[at + 4 + index] === byte)
    ) {
      adobeTransform = bytes[at + 15] ?? null;
    } else if (marker === markers.startOfScan) {
      if (sizeOffset < 0) throw new NdpiFormatError("The JPEG scan comes before its frame");
      return {
        header: bytes.slice(0, end),
        sizeOffset,
        mcuWidth,
        mcuHeight,
        restartInterval,
        storesRgb:
          adobeTransform === 0 ||
          (adobeTransform === null && componentIds.join(",") === "82,71,66"),
      };
    }
    at = end;
  }
  return null;
}

export function withoutEndOfImage(bytes: Uint8Array): Uint8Array {
  const last = bytes.length - 2;
  return last >= 0 && bytes[last] === 0xff && bytes[last + 1] === markers.endOfImage
    ? bytes.subarray(0, last)
    : bytes;
}

export function buildNdpiJpeg(
  frame: NdpiFrame,
  width: number,
  height: number,
  intervals: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  if (width < 1 || height < 1 || width > 65535 || height > 65535) {
    throw new NdpiFormatError(`A ${width} x ${height} tile does not fit one JPEG`);
  }
  const { header } = frame;
  let length = header.length;
  for (const interval of intervals) length += interval.length + 2;
  const jpeg = new Uint8Array(length);
  jpeg.set(header, 0);
  jpeg[frame.sizeOffset] = height >> 8;
  jpeg[frame.sizeOffset + 1] = height & 255;
  jpeg[frame.sizeOffset + 2] = width >> 8;
  jpeg[frame.sizeOffset + 3] = width & 255;
  let at = header.length;
  intervals.forEach((interval, index) => {
    if (index > 0) {
      jpeg[at] = 0xff;
      jpeg[at + 1] = markers.firstRestart + ((index - 1) % 8);
      at += 2;
    }
    jpeg.set(interval, at);
    at += interval.length;
  });
  jpeg[at] = 0xff;
  jpeg[at + 1] = markers.endOfImage;
  return jpeg;
}

export function ycbcrToRgb(pixels: Uint8Array): void {
  for (let at = 0; at + 2 < pixels.length; at += 3) {
    const y = pixels[at] ?? 0;
    const cb = (pixels[at + 1] ?? 0) - 128;
    const cr = (pixels[at + 2] ?? 0) - 128;
    const red = y + 1.402 * cr;
    const green = y - 0.344136 * cb - 0.714136 * cr;
    const blue = y + 1.772 * cb;
    pixels[at] = red < 0 ? 0 : red > 255 ? 255 : Math.round(red);
    pixels[at + 1] = green < 0 ? 0 : green > 255 ? 255 : Math.round(green);
    pixels[at + 2] = blue < 0 ? 0 : blue > 255 ? 255 : Math.round(blue);
  }
}
