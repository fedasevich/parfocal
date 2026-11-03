import type { StoredSettingValues as StoredValues } from "@parfocal/api-client";

export type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const deviceKey = "parfocal.device-settings";
const legacyThemeKey = "parfocal-theme";

const browserStorage = (): DeviceStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const parsed = (raw: string | null): StoredValues => {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export function readDeviceSettings(storage = browserStorage()): StoredValues {
  if (storage === undefined) return {};
  try {
    const values = parsed(storage.getItem(deviceKey));
    const legacy = storage.getItem(legacyThemeKey);
    if (legacy === null) return values;
    storage.removeItem(legacyThemeKey);
    if ("theme" in values) return values;
    const moved = { ...values, theme: legacy };
    storage.setItem(deviceKey, JSON.stringify(moved));
    return moved;
  } catch {
    return {};
  }
}

export function writeDeviceSetting(
  key: string,
  value: unknown,
  storage = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(deviceKey, JSON.stringify({ ...readDeviceSettings(storage), [key]: value }));
    return true;
  } catch {
    return false;
  }
}
