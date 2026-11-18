import { toolHintId } from "../hints/hints-seen.ts";
import { annotateRail, reviewRail, toolHints } from "../screens/viewer-tools/rails.ts";

export type ToolHintEntry = {
  readonly id: string;
  readonly tool: string;
  readonly label: string;
  readonly lines: readonly string[];
};

export function toolHintList(): ToolHintEntry[] {
  const labels = new Map<string, string>();
  for (const item of [...annotateRail, ...reviewRail].flat()) {
    if (!labels.has(item.tool)) labels.set(item.tool, item.label);
  }
  return [...labels].flatMap(([tool, label]) => {
    const lines = toolHints[tool];
    return lines === undefined || lines.length === 0
      ? []
      : [{ id: toolHintId(tool), tool, label, lines }];
  });
}
