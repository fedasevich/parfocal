import type { Point } from "./polygon-draft.ts";
import { ellipseSegments } from "./shapes.ts";

export type DragKind = "rectangle" | "ellipse";

export const minimumDragScreenPixels = 6;

export function dragCorner(start: Point, end: Point, equalSides: boolean): Point {
  if (!equalSides) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side) };
}

export function dragOutline(kind: DragKind, start: Point, corner: Point): Float32Array {
  if (kind === "rectangle") {
    return Float32Array.of(
      start.x,
      start.y,
      corner.x,
      start.y,
      corner.x,
      corner.y,
      start.x,
      corner.y,
    );
  }
  const cx = (start.x + corner.x) / 2;
  const cy = (start.y + corner.y) / 2;
  const rx = Math.abs(corner.x - start.x) / 2;
  const ry = Math.abs(corner.y - start.y) / 2;
  const out = new Float32Array(ellipseSegments * 2);
  for (let i = 0; i < ellipseSegments; i += 1) {
    const angle = (2 * Math.PI * i) / ellipseSegments;
    out[i * 2] = cx + Math.cos(angle) * rx;
    out[i * 2 + 1] = cy + Math.sin(angle) * ry;
  }
  return out;
}

export function finishDrag(
  kind: DragKind,
  start: Point,
  end: Point,
  equalSides: boolean,
  scale: number,
): Float32Array | null {
  const corner = dragCorner(start, end, equalSides);
  const width = Math.abs(corner.x - start.x) * scale;
  const height = Math.abs(corner.y - start.y) * scale;
  if (width < minimumDragScreenPixels || height < minimumDragScreenPixels) return null;
  return dragOutline(kind, start, corner);
}
