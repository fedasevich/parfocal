import type { ModelRunDraft, Ordering, TestTimeViews } from "@parfocal/api-client";

export type RunScopeChoice = "slide" | "view";

export type RunOptions = {
  readonly scope: RunScopeChoice;
  readonly views: TestTimeViews;
  readonly ordering: Ordering;
};

export type ViewRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const defaultRunOptions: RunOptions = { scope: "slide", views: 1, ordering: "raster" };

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

export function buildRunDraft(input: {
  readonly slideId: string;
  readonly options: RunOptions;
  readonly view: ViewRect | null;
}): ModelRunDraft | null {
  const { slideId, options, view } = input;
  if (options.scope === "view" && view === null) return null;
  return {
    slide_ids: [slideId],
    scope:
      options.scope === "view" && view !== null ? { kind: "view", ...view } : { kind: "slide" },
    parameters: {
      detector: { name: nucleiDetector },
      test_time_views: options.views,
      ordering: options.ordering,
    },
  };
}
