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

export function stillCameraOf(
  camera: { x: number; y: number; zoom: number },
  frame: StillFrame,
): StillCamera {
  return {
    x: (camera.x - frame.offsetX) / frame.scale,
    y: (camera.y - frame.offsetY) / frame.scale,
    scale: 2 ** camera.zoom * frame.scale,
  };
}

export type StillShape = {
  readonly box: [number, number, number, number];
  readonly path: string;
};

export function stillShapeOf(ring: ArrayLike<number>, frame: StillFrame): StillShape {
  const points: string[] = [];
  let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let at = 0; at + 1 < ring.length; at += 2) {
    const x = ((ring[at] ?? 0) - frame.offsetX) / frame.scale;
    const y = ((ring[at + 1] ?? 0) - frame.offsetY) / frame.scale;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }
  return { box, path: `M${points.join("L")}Z` };
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
