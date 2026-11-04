import type { Point } from "../../annotations/polygon-draft.ts";
import { cropCentre, levelZero } from "../viewer-tools/tool-geometry.ts";
import { hpfSize } from "./slide-geometry.ts";

export type StillImage = "overview" | "hpf";

const tenth = (value: number) => Math.round(value * 10) / 10;

export const imageOfKind = (kind: "region" | "cell"): StillImage =>
  kind === "cell" ? "hpf" : "overview";

export function stillToSlide(point: Point, image: StillImage): Point {
  if (image === "overview") {
    return {
      x: tenth(point.x * levelZero.overview),
      y: tenth(point.y * levelZero.overview),
    };
  }
  return {
    x: tenth(
      cropCentre.hpf[0] * levelZero.overview + (point.x - hpfSize.width / 2) * levelZero.hpf,
    ),
    y: tenth(
      cropCentre.hpf[1] * levelZero.overview + (point.y - hpfSize.height / 2) * levelZero.hpf,
    ),
  };
}

export function slideToStill(point: Point, image: StillImage): Point {
  if (image === "overview") {
    return { x: tenth(point.x / levelZero.overview), y: tenth(point.y / levelZero.overview) };
  }
  return {
    x: tenth(
      (point.x - cropCentre.hpf[0] * levelZero.overview) / levelZero.hpf + hpfSize.width / 2,
    ),
    y: tenth(
      (point.y - cropCentre.hpf[1] * levelZero.overview) / levelZero.hpf + hpfSize.height / 2,
    ),
  };
}

export function ringOfGeometry(geometry: unknown): Point[] | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const shape = geometry as { type?: unknown; coordinates?: unknown };
  if (shape.type !== "Polygon" || !Array.isArray(shape.coordinates)) return null;
  const ring: unknown = shape.coordinates[0];
  if (!Array.isArray(ring)) return null;
  const points = ring.flatMap((item: unknown) =>
    Array.isArray(item) && typeof item[0] === "number" && typeof item[1] === "number"
      ? [{ x: item[0], y: item[1] }]
      : [],
  );
  const first = points[0];
  const last = points.at(-1);
  const closed = points.length > 1 && first?.x === last?.x && first?.y === last?.y;
  return closed ? points.slice(0, -1) : points;
}
