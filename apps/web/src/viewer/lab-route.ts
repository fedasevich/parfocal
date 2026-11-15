import { readLabSettings, subscribeLabSettings, vivSwitchesOf } from "../lab/lab-settings.ts";
import { readDeveloperMode } from "../shell/developer-mode.ts";
import { labViewerPlan } from "./lab-plan.ts";
import { type EngineRouteId, engineRouteOf, type RoutePickerSource } from "./route-picker.ts";

export const labRouteSource: RoutePickerSource = {
  wanted: (): EngineRouteId =>
    readDeveloperMode() ? engineRouteOf[readLabSettings().renderer] : "viv",
  subscribe: subscribeLabSettings,
};

export function labRouteOptions() {
  if (!readDeveloperMode()) return {};
  return vivSwitchesOf(readLabSettings());
}

export function followLabPrefetch(route: { setPrefetch: (enabled: boolean) => void } | null) {
  return subscribeLabSettings(() => {
    if (readDeveloperMode()) route?.setPrefetch(readLabSettings().prefetch);
  });
}

export function readLabViewerPlan() {
  return readDeveloperMode() ? labViewerPlan(readLabSettings()) : null;
}
