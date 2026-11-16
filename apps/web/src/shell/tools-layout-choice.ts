import type { ArmOf } from "../flags/catalogue.ts";

export type ToolsLayout = "rail" | "dock";

export function chooseToolsLayout(
  setting: { value: string; source: string } | undefined,
  arm: ArmOf<"viewer_tools_layout">,
): ToolsLayout {
  if (setting === undefined || setting.source === "default") return arm;
  return setting.value === "dock" ? "dock" : "rail";
}
