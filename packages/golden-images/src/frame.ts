export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export type Rgb = readonly [number, number, number];

export function createFrame(width: number, height: number, data?: Uint8Array): Frame {
  const expected = width * height * 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`A frame needs a positive integer size, got ${width}x${height}`);
  }
  if (data && data.length !== expected) {
    throw new Error(`A ${width}x${height} RGBA frame needs ${expected} bytes, got ${data.length}`);
  }
  return { width, height, data: data ?? new Uint8Array(expected) };
}

export function flipRows(frame: Frame): Frame {
  const stride = frame.width * 4;
  const flipped = new Uint8Array(frame.data.length);
  for (let row = 0; row < frame.height; row++) {
    const from = row * stride;
    flipped.set(frame.data.subarray(from, from + stride), (frame.height - 1 - row) * stride);
  }
  return createFrame(frame.width, frame.height, flipped);
}

export function swapRedAndBlue(frame: Frame): Frame {
  const swapped = new Uint8Array(frame.data);
  for (let offset = 0; offset < swapped.length; offset += 4) {
    swapped[offset] = frame.data[offset + 2] ?? 0;
    swapped[offset + 2] = frame.data[offset] ?? 0;
  }
  return createFrame(frame.width, frame.height, swapped);
}

export function frameToBase64(frame: Frame): string {
  return Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength).toString(
    "base64",
  );
}

export function frameFromBase64(width: number, height: number, base64: string): Frame {
  return createFrame(width, height, new Uint8Array(Buffer.from(base64, "base64")));
}
