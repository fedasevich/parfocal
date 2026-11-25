import { useSyncExternalStore } from "react";
import {
  type DeviceStorage,
  readDeviceSettings,
  writeDeviceSetting,
} from "../shell/device-settings.ts";

export const typeBarHiddenKey = "review.type_bar_hidden";

export function readTypeBarHidden(storage?: DeviceStorage): boolean {
  const stored = storage === undefined ? readDeviceSettings() : readDeviceSettings(storage);
  return stored[typeBarHiddenKey] === true;
}

let current: boolean | null = null;
const listeners = new Set<() => void>();

const snapshot = () => {
  current ??= readTypeBarHidden();
  return current;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setTypeBarHidden(hidden: boolean): void {
  writeDeviceSetting(typeBarHiddenKey, hidden);
  current = hidden;
  for (const listener of listeners) listener();
}

export function useTypeBarHidden(): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(subscribe, snapshot, () => false);
  return [hidden, setTypeBarHidden];
}
