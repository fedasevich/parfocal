import { annotateRail, reviewRail, toolHints } from "../screens/viewer-tools/rails.ts";

const toolOfAction: ReadonlyMap<string, string> = new Map(
  [...annotateRail, ...reviewRail]
    .flat()
    .flatMap((item) => (item.action === undefined ? [] : [[item.action, item.tool] as const])),
);

export function toolHintText(tool: string): string | undefined {
  const lines = toolHints[tool];
  return lines === undefined || lines.length === 0 ? undefined : lines.join(". ");
}

export function actionHintText(action: string): string | undefined {
  const tool = toolOfAction.get(action);
  return tool === undefined ? undefined : toolHintText(tool);
}
