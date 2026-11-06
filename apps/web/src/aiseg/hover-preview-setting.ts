import { useSyncExternalStore } from "react";

const storageKey = "parfocal.smart-hover-preview";

const listeners = new Set<() => void>();

let current: boolean | null = null;

function stored(): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== "off";
  } catch {
    return true;
  }
}

function hoverPreviewNow(): boolean {
  current ??= stored();
  return current;
}

export function setHoverPreview(next: boolean): void {
  current = next;
  try {
    window.localStorage.setItem(storageKey, next ? "on" : "off");
  } catch {
    current = next;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHoverPreview(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, hoverPreviewNow, () => true);
  return [on, setHoverPreview];
}
