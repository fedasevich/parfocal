import { readLabSettings, subscribeLabSettings, vivSwitchesOf } from "../lab/lab-settings.ts";
import { readDeveloperMode } from "../shell/developer-mode.ts";
import { labViewerPlan } from "./lab-plan.ts";

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
