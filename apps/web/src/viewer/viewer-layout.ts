export const viewerLayouts = ["compare", "focus"] as const;

export type ViewerLayout = (typeof viewerLayouts)[number];

export type StageLayout = "single" | ViewerLayout | "object";

export type LayoutChrome = {
  readonly topBar: boolean;
  readonly rail: boolean;
  readonly panel: boolean;
  readonly toolKeys: boolean;
};

const layoutChrome: Record<StageLayout, LayoutChrome> = {
  single: { topBar: true, rail: true, panel: true, toolKeys: true },
  compare: { topBar: true, rail: true, panel: true, toolKeys: true },
  focus: { topBar: false, rail: false, panel: false, toolKeys: false },
  object: { topBar: false, rail: false, panel: false, toolKeys: false },
};

export function stageLayoutOf(layout: ViewerLayout | undefined): StageLayout {
  return layout ?? "single";
}

export function layoutChromeOf(layout: StageLayout): LayoutChrome {
  return layoutChrome[layout];
}

const oldCompareScenes: ReadonlySet<unknown> = new Set(["picking", "picked"]);

export function layoutOfOldAddress(given: {
  readonly scene?: unknown;
  readonly focus?: unknown;
}): { scene: undefined; focus: undefined; layout: ViewerLayout } | null {
  const { scene: oldScene, focus: oldFocus } = given;
  if (oldCompareScenes.has(oldScene)) {
    return { scene: undefined, focus: undefined, layout: "compare" };
  }
  if (oldFocus === true || oldFocus === "true") {
    return { scene: undefined, focus: undefined, layout: "focus" };
  }
  return null;
}
