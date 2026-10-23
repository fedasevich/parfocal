import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PNG } from "pngjs";
import { createFrame, type Frame } from "#frame.ts";

export function decodePng(bytes: Uint8Array): Frame {
  const image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return createFrame(image.width, image.height, new Uint8Array(image.data));
}

export function encodePng(frame: Frame): Buffer {
  const image = new PNG({ width: frame.width, height: frame.height });
  image.data = Buffer.from(frame.data);
  return PNG.sync.write(image, { colorType: 6 });
}

export function readPng(path: string): Frame {
  return decodePng(readFileSync(path));
}

export function writePng(path: string, frame: Frame): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(frame));
}
