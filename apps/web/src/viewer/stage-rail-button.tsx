import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { toolHintId, useHintsSeen } from "../hints/hints-seen.ts";
import type { RailTool } from "../screens/review/viewer-frame.tsx";
import { stageToolOf } from "./stage-tools.ts";
import { toolHintText } from "./tool-hint-text.ts";

export function StageRailButton({
  item,
  tool,
  dock,
  onTool,
}: {
  item: RailTool;
  tool: string;
  dock: boolean;
  onTool: (next: string | null) => void;
}) {
  const hintsSeen = useHintsSeen();
  const stageTool = stageToolOf(item.tool);
  const hint = hintsSeen.seen.has(toolHintId(item.tool)) ? toolHintText(item.tool) : undefined;
  return (
    <ToolRailButton
      {...(hint === undefined ? {} : { hint })}
      icon={item.icon}
      label={item.label}
      tipSide={dock ? "top" : "right"}
      ai={item.ai ?? false}
      {...(item.action === undefined ? {} : { action: item.action })}
      data-tool={item.tool}
      className={dock ? undefined : "[@media(max-height:760px)]:size-7"}
      pressed={tool === stageTool}
      onPressedChange={(on) => onTool(on ? stageTool : null)}
    />
  );
}
