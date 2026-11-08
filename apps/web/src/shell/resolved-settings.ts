import { resolveSettings, type SettingValues, useGetMySettingLayers } from "@parfocal/api-client";
import { useMemo } from "react";
import { readDeviceSettings } from "./device-settings.ts";

export function useResolvedSettings(enabled = true): SettingValues | undefined {
  const response = useGetMySettingLayers({ query: { enabled } }).data;
  const layers = response?.status === 200 ? response.data : undefined;
  return useMemo(
    () =>
      layers === undefined
        ? undefined
        : resolveSettings({ ...layers, device: readDeviceSettings() }),
    [layers],
  );
}
