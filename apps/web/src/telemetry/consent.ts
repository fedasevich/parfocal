import type { Analytics } from "../clients.ts";
import {
  type DeviceStorage,
  readDeviceSettings,
  writeDeviceSetting,
} from "../shell/device-settings.ts";

const optOutKey = "analytics_opt_out";

export function analyticsOptedOut(storage?: DeviceStorage): boolean {
  return readDeviceSettings(storage)[optOutKey] === true;
}

export function setAnalyticsOptOut(optedOut: boolean, storage?: DeviceStorage): boolean {
  return writeDeviceSetting(optOutKey, optedOut, storage);
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
