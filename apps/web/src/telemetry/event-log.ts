import type { Analytics } from "../clients.ts";
import type { DeviceStorage } from "../shell/device-settings.ts";

export type LoggedEvent = { name: string; properties: Record<string, string | number> };

const logKey = "parfocal.event-log";
const logLimit = 300;

const browserStorage = (): DeviceStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const isLogged = (value: unknown): value is LoggedEvent =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LoggedEvent).name === "string" &&
  typeof (value as LoggedEvent).properties === "object";

export function readEventLog(storage = browserStorage()): LoggedEvent[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(logKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isLogged) : [];
  } catch {
    return [];
  }
}

export function clearEventLog(storage = browserStorage()): void {
  storage?.removeItem(logKey);
}

export function loggingAnalytics(inner: Analytics, storage = browserStorage()): Analytics {
  return {
    capture(event, properties) {
      if (storage !== undefined) {
        try {
          const kept = [...readEventLog(storage), { name: event, properties }].slice(-logLimit);
          storage.setItem(logKey, JSON.stringify(kept));
        } catch {
          storage.removeItem(logKey);
        }
      }
      inner.capture(event, properties);
    },
  };
}
