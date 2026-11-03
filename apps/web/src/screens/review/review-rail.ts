import { useMemo } from "react";
import { keyRegistry } from "../../keys/catalogue.ts";
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

export function useReviewToolKeys(onTool: (tool: ReviewTool) => void, enabled = true) {
  const bindings = useMemo(
    () =>
      enabled
        ? keyRegistry.bindings({ scopes: ["annotate"], only: Object.keys(reviewToolActions) })
        : [],
    [enabled],
  );
  useHotkeys(bindings, (fired: Fired) => {
    const tool = reviewToolActions[fired.action];
    if (fired.phase === "press" && tool) onTool(tool);
  });
}
