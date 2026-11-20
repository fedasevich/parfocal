import type { RailTool } from "../screens/review/viewer-frame.tsx";
import { annotateRail, reviewRail } from "../screens/viewer-tools/rails.ts";

export const workspaces = ["review", "annotate"] as const;

export type SlideWorkspace = (typeof workspaces)[number];

export type DragBehaviour = "pan" | "marquee";

export type WorkspaceSetup = {
  readonly label: string;
  readonly rail: RailTool[][];
  readonly restingTool: "hand" | "select";
  readonly dragBehaviour: DragBehaviour;
  readonly countPanel: "when-counting" | "when-markers";
};

export const workspaceSetups: Record<SlideWorkspace, WorkspaceSetup> = {
  review: {
    label: "Review",
    rail: reviewRail,
    restingTool: "select",
    dragBehaviour: "pan",
    countPanel: "when-markers",
  },
  annotate: {
    label: "Annotate",
    rail: annotateRail,
    restingTool: "select",
    dragBehaviour: "marquee",
    countPanel: "when-counting",
  },
};

const readOnlyTools = new Set(["select", "hand", "ruler"]);

const lookOnly = (rail: RailTool[][]): RailTool[][] =>
  rail
    .map((group) => group.filter((item) => readOnlyTools.has(item.tool)))
    .filter((group) => group.length > 0);

export const readOnlySetups: Record<SlideWorkspace, WorkspaceSetup> = {
  review: { ...workspaceSetups.review, rail: lookOnly(reviewRail) },
  annotate: { ...workspaceSetups.annotate, rail: lookOnly(annotateRail), dragBehaviour: "pan" },
};

export function setupOf(workspace: SlideWorkspace, readOnly: boolean): WorkspaceSetup {
  return (readOnly ? readOnlySetups : workspaceSetups)[workspace];
}

export function railHasTool(setup: WorkspaceSetup, tool: string): boolean {
  return setup.rail.some((group) => group.some((item) => item.tool === tool));
}

export function showsCountPanel(
  setup: WorkspaceSetup,
  state: { counting: boolean; markers: number },
): boolean {
  return setup.countPanel === "when-counting"
    ? state.counting || state.markers > 0
    : state.markers > 0;
}
