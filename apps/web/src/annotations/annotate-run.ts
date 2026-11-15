import type {
  JobStatus,
  ModelRun,
  ModelRunDraft,
  PolygonGeometry,
  SelectionScope,
  ViewScope,
} from "@parfocal/api-client";
import { polygonToGeoJson } from "./geojson.ts";
import { type Extent, isClosedKind, outlineOf, type Shape, type ShapeId } from "./shapes.ts";

export const annotateRunDetector = "hovernet";

export type AnnotateRunScope = "selection" | "view";

export type SlideArea = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SlideSize = { readonly width: number; readonly height: number };

const clampTo = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export function viewScopeOf(area: SlideArea, slide: SlideSize): ViewScope | null {
  const x = Math.round(clampTo(area.x, 0, slide.width));
  const y = Math.round(clampTo(area.y, 0, slide.height));
  const right = Math.round(clampTo(area.x + area.width, 0, slide.width));
  const bottom = Math.round(clampTo(area.y + area.height, 0, slide.height));
  if (right - x < 1 || bottom - y < 1) return null;
  return { kind: "view", x, y, width: right - x, height: bottom - y };
}

function boxOf(extents: readonly Extent[]): PolygonGeometry {
  const left = Math.min(...extents.map((extent) => extent[0]));
  const top = Math.min(...extents.map((extent) => extent[1]));
  const right = Math.max(...extents.map((extent) => extent[2]));
  const bottom = Math.max(...extents.map((extent) => extent[3]));
  return polygonToGeoJson(Float32Array.of(left, top, right, top, right, bottom, left, bottom));
}

export function selectionScopeOf(
  shapes: ReadonlyMap<ShapeId, Shape>,
  selected: readonly ShapeId[],
): SelectionScope | null {
  const closed = selected.flatMap((id) => {
    const shape = shapes.get(id);
    return shape !== undefined && isClosedKind(shape.kind) ? [shape] : [];
  });
  const [only] = closed;
  if (only === undefined) return null;
  const geometry =
    closed.length === 1 && only.kind !== "brush"
      ? polygonToGeoJson(outlineOf(only))
      : boxOf(closed.map((shape) => shape.bounds));
  return { kind: "selection", geometry };
}

export function annotateRunDraft(input: {
  readonly slideId: string;
  readonly taskId: string;
  readonly scope: SelectionScope | ViewScope;
}): ModelRunDraft {
  return {
    slide_ids: [input.slideId],
    task_id: input.taskId,
    scope: input.scope,
    parameters: { detector: { name: annotateRunDetector } },
  };
}

const ended: readonly JobStatus[] = ["done", "cancelled", "failed"];

export const runEnded = (status: JobStatus): boolean => ended.includes(status);

export function joinableSetOf(
  run: Pick<ModelRun, "status" | "task_id" | "slide_id" | "result_set_id">,
  task: { readonly taskId: string; readonly slideId: string },
): string | null {
  if (run.status !== "done" || run.task_id !== task.taskId || run.slide_id !== task.slideId) {
    return null;
  }
  return run.result_set_id;
}
