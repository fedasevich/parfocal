import { useCallback, useSyncExternalStore } from "react";

const storageKey = "parfocal.pinned-slide-strip";
const changeEvent = "parfocal:pinned-slide-strip";

function read(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "on";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePinnedStrip(): [boolean, (value: boolean) => void] {
  const pinned = useSyncExternalStore(subscribe, read, () => false);
  const update = useCallback((value: boolean) => {
    try {
      window.localStorage.setItem(storageKey, value ? "on" : "off");
    } catch {
      return;
    }
    window.dispatchEvent(new Event(changeEvent));
  }, []);
  return [pinned, update];
}
