import { useState } from "react";
import type { Point, Segment } from "../../measure/ruler-maths.ts";
import {
  largestMeasurement,
  lineMm,
  preDrawnLine,
  regionOutline,
} from "../viewer-tools/area-measure.ts";

type MeasurableArea = {
  object: string;
  size_mm: number | null;
  outline?: readonly number[] | null | undefined;
};

type SlideSize = { width: number; height: number } | null;

export type AreaMeasure = {
  object: string;
  across: string;
  mm: number;
  line: Segment;
  outline: Point[];
};

export function useAreaMeasures(
  areas: readonly MeasurableArea[],
  slideSize: SlideSize,
  across: string | null,
) {
  const [lines, setLines] = useState<ReadonlyMap<string, Segment>>(new Map());
  const areaOf = (object: string) => areas.find((area) => area.object === object);
  const outlineOf = (object: string) => {
    const area = areaOf(object);
    return area ? regionOutline(area, slideSize) : [];
  };
  const order = [...lines.keys(), ...(across !== null && !lines.has(across) ? [across] : [])];
  const measurements = order.flatMap((object, index): AreaMeasure[] => {
    const outline = outlineOf(object);
    const axis = preDrawnLine(outline);
    const line = lines.get(object) ?? axis;
    if (axis === null || line === null) return [];
    const mm = lineMm(line, axis, areaOf(object)?.size_mm ?? 0);
    return [{ object: `M${index + 1}`, across: object, mm, line, outline }];
  });
  const setLine = (object: string, line: Segment) =>
    setLines((before) => new Map(before).set(object, line));
  const open = (object: string) => {
    const axis = preDrawnLine(outlineOf(object));
    if (axis !== null && !lines.has(object)) setLine(object, axis);
  };
  const remove = (object: string) =>
    setLines((before) => {
      const next = new Map(before);
      next.delete(object);
      return next;
    });
  return {
    measurements,
    current: measurements.find((item) => item.across === across) ?? null,
    largest: largestMeasurement(measurements),
    mmOf: (object: string) => measurements.find((item) => item.across === object)?.mm ?? null,
    open,
    setLine,
    remove,
  };
}
