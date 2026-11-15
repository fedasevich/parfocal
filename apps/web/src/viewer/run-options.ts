import type { ModelRunDraft, Ordering, RunScope } from "@parfocal/api-client";

export type RunScopeChoice = "slide" | "view" | "selection";

export type RunOptions = {
  readonly scope: RunScopeChoice;
  readonly ordering: Ordering;
};

export type ViewRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const defaultRunOptions: RunOptions = { scope: "slide", ordering: "raster" };

export const nucleiDetector = "hovernet";

const clampTo = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export function viewScopeOf(
  area: ViewRect,
  slide: { readonly width: number; readonly height: number },
): ViewRect | null {
  const x = Math.round(clampTo(area.x, 0, slide.width));
  const y = Math.round(clampTo(area.y, 0, slide.height));
  const right = Math.round(clampTo(area.x + area.width, 0, slide.width));
  const bottom = Math.round(clampTo(area.y + area.height, 0, slide.height));
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

export function boxGeometry(box: ViewRect) {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return {
    type: "Polygon",
    coordinates: [
      [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left, top],
      ],
    ],
  } as const;
}

function scopeOf(options: RunOptions, view: ViewRect | null, selection: ViewRect | null) {
  if (options.scope === "view") return view === null ? null : ({ kind: "view", ...view } as const);
  if (options.scope === "selection") {
    return selection === null
      ? null
      : ({ kind: "selection", geometry: boxGeometry(selection) } as const);
  }
  return { kind: "slide" } as const;
}

export function buildRunDraft(input: {
  readonly slideId: string;
  readonly options: RunOptions;
  readonly view: ViewRect | null;
  readonly selection?: ViewRect | null;
}): ModelRunDraft | null {
  const scope: RunScope | null = scopeOf(input.options, input.view, input.selection ?? null);
  if (scope === null) return null;
  return {
    slide_ids: [input.slideId],
    scope,
    parameters: {
      detector: { name: nucleiDetector },
      ordering: input.options.ordering,
    },
  };
}

export function canTuneRun(input: {
  readonly tenantRole: string | undefined;
  readonly projectRole: string | null | undefined;
}): boolean {
  return input.tenantRole === "researcher" || input.projectRole === "owner";
}
