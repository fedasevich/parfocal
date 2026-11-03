import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";

export const stayTools = ["hand", "ruler", "comment"] as const;

export type StayTool = (typeof stayTools)[number];

export type ReviewTool = "select" | StayTool | "smart";

export type ToolRoute =
  | { kind: "stay"; tool: StayTool | undefined; tab?: "comments" }
  | { kind: "annotate"; tool: "smart" };

export const reviewToolActions: Record<string, ReviewTool> = {
  tselect: "select",
  thand: "hand",
  truler: "ruler",
  tcomment: "comment",
  tsmart: "smart",
};

export function routeReviewTool(tool: string): ToolRoute | null {
  if (tool === "select") return { kind: "stay", tool: undefined };
  if (tool === "hand" || tool === "ruler") return { kind: "stay", tool };
  if (tool === "comment") return { kind: "stay", tool, tab: "comments" };
  if (tool === "smart") return { kind: "annotate", tool };
  return null;
}

export function shownReviewTool(tool: StayTool | undefined, idle: boolean): ReviewTool {
  return tool ?? (idle ? "hand" : "select");
}

const reviewToolIds = Object.keys(reviewToolActions);

export function useReviewToolKeys(onTool: (tool: ReviewTool) => void, enabled = true) {
  const bindings = useBindings(["annotate"], reviewToolIds, enabled);
  useHotkeys(bindings, (fired: Fired) => {
    const tool = reviewToolActions[fired.action];
    if (fired.phase === "press" && tool) onTool(tool);
  });
}

export const railKeyActions = ["annotate", "aitools"];

type RailItem = { tool: string; action?: string | undefined };

export function railKeyIds(groups: readonly (readonly RailItem[])[]): string[] {
  return groups
    .flat()
    .flatMap((item) =>
      item.action !== undefined && railKeyActions.includes(item.action) ? [item.action] : [],
    );
}

export function railToolOf(groups: readonly (readonly RailItem[])[], fired: Fired): string | null {
  if (fired.phase !== "press") return null;
  return groups.flat().find((item) => item.action === fired.action)?.tool ?? null;
}

export function useRailKeys(
  groups: readonly (readonly RailItem[])[],
  onTool: ((tool: string) => void) | undefined,
) {
  const bindings = useBindings(["review"], railKeyIds(groups), onTool !== undefined);
  useHotkeys(bindings, (fired: Fired) => {
    const tool = railToolOf(groups, fired);
    if (tool !== null) onTool?.(tool);
  });
}
