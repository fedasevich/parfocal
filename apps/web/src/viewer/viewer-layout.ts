export const viewerLayouts = ["compare", "focus"] as const;

export type ViewerLayout = (typeof viewerLayouts)[number];

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
