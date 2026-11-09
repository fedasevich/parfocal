import { useSyncExternalStore } from "react";

const storageKey = "parfocal.slide-brightness";

export const minBrightness = 20;
export const maxBrightness = 140;
export const brightnessStep = 10;

export const brightnessKeyIds = ["brightup", "brightdown", "brightreset"] as const;

export function brightnessAfterKey(action: string, value: number): number {
  if (action === "brightup") return Math.min(maxBrightness, value + brightnessStep);
  if (action === "brightdown") return Math.max(minBrightness, value - brightnessStep);
  if (action === "brightreset") return 100;
  return value;
}

function remembered(): number {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= minBrightness && stored <= maxBrightness
      ? stored
      : 100;
  } catch {
    return 100;
  }
}

const listeners = new Set<() => void>();
let current = remembered();

const notify = () => {
  for (const listener of listeners) listener();
};

export function setSlideBrightness(next: number): void {
  current = next;
  try {
    window.localStorage.setItem(storageKey, String(next));
  } catch {
    return;
  } finally {
    notify();
  }
}

export const subscribeToSlideBrightness = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const readSlideBrightness = () => current;

export function useSlideBrightness(): [number, (value: number) => void] {
  return [
    useSyncExternalStore(subscribeToSlideBrightness, readSlideBrightness),
    setSlideBrightness,
  ];
}
