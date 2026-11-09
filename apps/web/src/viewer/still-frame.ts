import { overviewSize } from "../screens/review/slide-geometry.ts";

export type StillCamera = { readonly x: number; readonly y: number; readonly scale: number };

export type StillFrame = {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

export function overviewFrame(slide: { width: number; height: number }): StillFrame {
  const scale = Math.min(slide.width / overviewSize.width, slide.height / overviewSize.height);
  return {
    scale,
    offsetX: (slide.width - overviewSize.width * scale) / 2,
    offsetY: (slide.height - overviewSize.height * scale) / 2,
  };
}

export function engineCameraOf(camera: StillCamera, frame: StillFrame) {
  return {
    x: camera.x * frame.scale + frame.offsetX,
    y: camera.y * frame.scale + frame.offsetY,
    zoom: Math.log2(camera.scale / frame.scale),
  };
}

export function engineRing(ring: ArrayLike<number>, frame: StillFrame): Float32Array {
  const placed = new Float32Array(ring.length);
  for (let at = 0; at + 1 < ring.length; at += 2) {
    placed[at] = (ring[at] ?? 0) * frame.scale + frame.offsetX;
    placed[at + 1] = (ring[at + 1] ?? 0) * frame.scale + frame.offsetY;
  }
  return placed;
}

export function ringOfPath(path: string): Float32Array {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const ring = new Float32Array(numbers.length - (numbers.length % 2));
  for (let at = 0; at < ring.length; at += 1) ring[at] = Number(numbers[at]);
  return ring;
}
