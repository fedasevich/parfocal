import { resolveSetting, useGetMySettingLayers } from "@parfocal/api-client";
import { useMemo } from "react";
import { useArm } from "../flags/use-arm.ts";
import { readDeviceSettings } from "./device-settings.ts";
import { chooseToolsLayout, type ToolsLayout } from "./tools-layout-choice.ts";

export type { ToolsLayout } from "./tools-layout-choice.ts";

export function useToolsLayout(): ToolsLayout {
  const response = useGetMySettingLayers().data;
  const layers = response?.status === 200 ? response.data : undefined;
  const setting = useMemo(
    () =>
      layers === undefined
        ? undefined
        : resolveSetting("tools", { ...layers, device: readDeviceSettings() }),
    [layers],
  );
  const arm = useArm("viewer_tools_layout", setting?.source === "default");
  return chooseToolsLayout(setting, arm);
}
