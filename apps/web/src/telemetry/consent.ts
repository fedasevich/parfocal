import type { Analytics } from "../clients.ts";
import {
  type DeviceStorage,
  readDeviceSettings,
  writeDeviceSetting,
} from "../shell/device-settings.ts";

const optOutKey = "analytics_opt_out";
const policyKey = "analytics_policy";

export type AnalyticsPolicy = "person" | "on" | "off";

export type AnalyticsChoices = {
  analytics_policy: AnalyticsPolicy;
  analytics_opt_out: boolean;
};

const policyOf = (value: unknown): AnalyticsPolicy | undefined =>
  value === "person" || value === "on" || value === "off" ? value : undefined;

export function analyticsAllowed(choices: AnalyticsChoices): boolean {
  if (choices.analytics_policy === "off") return false;
  if (choices.analytics_policy === "on") return true;
  return !choices.analytics_opt_out;
}

export function analyticsOptedOut(storage?: DeviceStorage): boolean {
  const stored = readDeviceSettings(storage);
  const policy = policyOf(stored[policyKey]);
  if (policy === undefined) return true;
  return !analyticsAllowed({
    analytics_policy: policy,
    analytics_opt_out: stored[optOutKey] === true,
  });
}

export function rememberAnalyticsChoices(choices: AnalyticsChoices, storage?: DeviceStorage): void {
  writeDeviceSetting(policyKey, choices.analytics_policy, storage);
  writeDeviceSetting(optOutKey, choices.analytics_opt_out, storage);
}

export function consentedAnalytics(
  analytics: Analytics,
  optedOut: () => boolean = analyticsOptedOut,
): Analytics {
  return {
    capture(event, properties) {
      if (optedOut()) return;
      analytics.capture(event, properties);
    },
  };
}
