import { type AnnotationDocument, isShapeHidden } from "../annotations/document.ts";
import { isClosedKind, type Shape, type ShapeId } from "../annotations/shapes.ts";
import type { LengthUnits } from "./length-units.ts";
import { formatRulerLength, segmentOfRuler } from "./ruler-maths.ts";
import { formatArea, formatPerimeter, measureShape } from "./shape-measure.ts";

export type MeasurementRow = {
  readonly shapeId: ShapeId;
  readonly label: string;
  readonly kind: "ruler" | "area";
  readonly shapeKind: Shape["kind"];
  readonly value: string;
  readonly area: string | null;
  readonly category: string;
  readonly drawnAt: number | null;
};

export type MeasurementNames = ReadonlyMap<string, string>;

export function buildMeasurementRows(
  doc: AnnotationDocument,
  micronsPerPixel: number | null,
  drawnAt: ReadonlyMap<ShapeId, number>,
  classNames: MeasurementNames = new Map(),
  units?: LengthUnits,
): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  const shapes = [...doc.shapes.values()].sort((a, b) => a.id - b.id);
  for (const shape of shapes) {
    const isRuler = shape.kind === "ruler";
    if (!isRuler && !isClosedKind(shape.kind)) continue;
    if (isShapeHidden(doc, shape)) continue;
    const label = `M${rows.length + 1}`;
    const time = drawnAt.get(shape.id) ?? null;
    if (isRuler) {
      rows.push({
        shapeId: shape.id,
        label,
        kind: "ruler",
        shapeKind: shape.kind,
        value: formatRulerLength(segmentOfRuler(shape), micronsPerPixel, units),
        area: null,
        category: "Ruler",
        drawnAt: time,
      });
      continue;
    }
    const measure = measureShape(shape, micronsPerPixel);
    if (measure === null) continue;
    rows.push({
      shapeId: shape.id,
      label,
      kind: "area",
      shapeKind: shape.kind,
      value: formatPerimeter(measure, units),
      area: formatArea(measure, units),
      category:
        shape.classKey === null
          ? "No category"
          : (classNames.get(shape.classKey) ?? shape.classKey),
      drawnAt: time,
    });
  }
  return rows;
}

export function noteDrawnTimes(
  previous: ReadonlyMap<ShapeId, number>,
  doc: AnnotationDocument,
  now: number,
): ReadonlyMap<ShapeId, number> {
  let next: Map<ShapeId, number> | null = null;
  for (const id of doc.shapes.keys()) {
    if (previous.has(id)) continue;
    next ??= new Map(previous);
    next.set(id, now);
  }
  return next ?? previous;
}

export function formatDrawnTime(drawnAt: number | null): string {
  if (drawnAt === null) return "";
  const date = new Date(drawnAt);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}
