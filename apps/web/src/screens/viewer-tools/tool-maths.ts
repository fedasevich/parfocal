import type { MapRect } from "@parfocal/ui/lib/minimap-box";
import { regionShapes } from "../review/slide-geometry.ts";
import type { Camera, StillLook } from "../review/slide-still.tsx";
import { cropCentre, imageCentre, perImagePixel } from "./tool-geometry.ts";

export type Size = { width: number; height: number };

export const boxCentre = (box: [number, number, number, number]): [number, number] => [
  (box[0] + box[2]) / 2,
  (box[1] + box[3]) / 2,
];

export function toOverview(look: StillLook, point: [number, number]): [number, number] {
  if (look === "overview") return point;
  const k = perImagePixel[look];
  const centre = cropCentre[look];
  return [centre[0] + (point[0] - imageCentre[0]) * k, centre[1] + (point[1] - imageCentre[1]) * k];
}

export function viewportOf(look: StillLook, camera: Camera, size: Size): MapRect {
  const width = size.width / camera.scale;
  const height = size.height / camera.scale;
  const [x, y] = toOverview(look, [camera.x - width / 2, camera.y - height / 2]);
  const k = look === "overview" ? 1 : perImagePixel[look];
  return [x, y, width * k, height * k];
}

export const toScreen = (camera: Camera, size: Size, point: [number, number]) => ({
  x: (point[0] - camera.x) * camera.scale + size.width / 2,
  y: (point[1] - camera.y) * camera.scale + size.height / 2,
});

export function areaExtent(object: string): MapRect {
  const box = regionShapes[object]?.box ?? [0, 0, 1400, 1924];
  const pad = 0.12 * Math.max(box[2] - box[0], box[3] - box[1]);
  return [box[0] - pad, box[1] - pad, box[2] - box[0] + 2 * pad, box[3] - box[1] + 2 * pad];
}

export type Measurement = { object: string; mm: number; across: string };

export const measuredSize = (size: number) => Number((size * 1.04).toFixed(1));

export function rulerEnds(across: string): [[number, number], [number, number]] {
  const box = regionShapes[across]?.box ?? [0, 0, 0, 0];
  const [cx, cy] = boxCentre(box);
  return box[2] - box[0] >= box[3] - box[1]
    ? [
        [box[0], cy],
        [box[2], cy],
      ]
    : [
        [cx, box[1]],
        [cx, box[3]],
      ];
}

const clamp = (value: number, low: number, high: number) =>
  low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));

export function coverHome(image: Size, centre: [number, number], zoom = 1) {
  return (size: Size): Camera => {
    const scale = Math.max(size.width / image.width, size.height / image.height) * zoom;
    const halfWidth = size.width / 2 / scale;
    const halfHeight = size.height / 2 / scale;
    return {
      x: clamp(centre[0], halfWidth, image.width - halfWidth),
      y: clamp(centre[1], halfHeight, image.height - halfHeight),
      scale,
    };
  };
}
