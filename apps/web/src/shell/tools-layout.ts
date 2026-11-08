import { useResolvedSettings } from "./resolved-settings.ts";

export type ToolsLayout = "rail" | "dock";

export function useToolsLayout(): ToolsLayout {
  return useResolvedSettings()?.tools === "dock" ? "dock" : "rail";
}
