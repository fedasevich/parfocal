import { useSyncExternalStore } from "react";

const storageKey = "parfocal-developer-mode";
const changed = "parfocal-developer-mode-changed";

export function readDeveloperMode(): boolean {
  return window.localStorage.getItem(storageKey) === "on";
}

export function setDeveloperMode(on: boolean): void {
  if (on) window.localStorage.setItem(storageKey, "on");
  else window.localStorage.removeItem(storageKey);
  window.dispatchEvent(new Event(changed));
}

const subscribe = (notify: () => void) => {
  window.addEventListener(changed, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(changed, notify);
    window.removeEventListener("storage", notify);
  };
};

export function useDeveloperMode(): boolean {
  return useSyncExternalStore(subscribe, readDeveloperMode, () => false);
}
