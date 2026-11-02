import { hpfSize, overviewSize } from "./slide-geometry.ts";
import type { Camera } from "./slide-still.tsx";

export type CameraSearch = {
  x?: number | undefined;
  y?: number | undefined;
  z?: number | undefined;
};

type StillImage = "overview" | "hpf";

const imageSizes = { overview: overviewSize, hpf: hpfSize } as const;
const maxSearchScale = 20;
const rounded = (value: number) => Math.round(value * 10_000) / 10_000;
const within = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function cameraToSearch(image: StillImage, camera: Camera): Required<CameraSearch> {
  const size = imageSizes[image];
  return {
    x: rounded(within(camera.x / size.width, 0, 1)),
    y: rounded(within(camera.y / size.height, 0, 1)),
    z: rounded(within(camera.scale, 0.0001, maxSearchScale)),
  };
}

export function cameraFromSearch(image: StillImage, search: CameraSearch): Camera | null {
  if (search.x === undefined || search.y === undefined || search.z === undefined) return null;
  if (search.z <= 0) return null;
  const size = imageSizes[image];
  return { x: search.x * size.width, y: search.y * size.height, scale: search.z };
}
