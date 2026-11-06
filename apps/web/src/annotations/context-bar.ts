import { annotateRail, toolHints } from "../screens/viewer-tools/rails.ts";
import { railToolOf } from "../viewer/stage-tools.ts";

export interface ContextBarModel {
  readonly label: string;
  readonly hints: readonly string[];
  readonly classStrip: boolean;
}

export interface ContextBarState {
  readonly activeSlot: number | null;
  readonly activeName: string | null;
  readonly counted: number;
}

const classTools: ReadonlySet<string> = new Set([
  "smart",
  "auto",
  "poly",
  "free",
  "rect",
  "ellipse",
  "marker",
  "brush",
]);

const railLabels: ReadonlyMap<string, string> = new Map(
  annotateRail.flat().map((item) => [item.tool, item.label]),
);

export function takesActiveClass(stageTool: string): boolean {
  return classTools.has(railToolOf(stageTool));
}

function markerHints(state: ContextBarState): string[] {
  const picked =
    state.activeSlot !== null && state.activeName !== null
      ? `Class ${state.activeSlot} ${state.activeName.toLowerCase()} · ${state.counted} counted`
      : `${state.counted} counted`;
  return ["Click to count", picked];
}

export function contextBarOf(stageTool: string, state: ContextBarState): ContextBarModel {
  const rail = railToolOf(stageTool);
  const hints = rail === "marker" ? markerHints(state) : (toolHints[rail] ?? []);
  return {
    label: railLabels.get(rail) ?? stageTool,
    hints,
    classStrip: classTools.has(rail),
  };
}

export function acceptLabel(activeName: string | null): string {
  return activeName === null ? "Accept" : `Accept as ${activeName.toLowerCase()}`;
}
