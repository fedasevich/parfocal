import { useSyncExternalStore } from "react";

export const outlineModeChoices = ["fade", "mark-unsure", "bands"] as const;

export type OutlineModeChoice = (typeof outlineModeChoices)[number];

export const outlineModeLabels: Readonly<Record<OutlineModeChoice, string>> = {
  fade: "Fade",
  "mark-unsure": "Mark unsure",
  bands: "Bands",
};

export const defaultOutlineModeChoice: OutlineModeChoice = "fade";

const storageKey = "parfocal.outline-mode";

const listeners = new Set<() => void>();

let current: OutlineModeChoice | null = null;

function stored(): OutlineModeChoice {
  try {
    const value = window.localStorage.getItem(storageKey);
    return outlineModeChoices.find((choice) => choice === value) ?? defaultOutlineModeChoice;
  } catch {
    return defaultOutlineModeChoice;
  }
}

function outlineModeNow(): OutlineModeChoice {
  current ??= stored();
  return current;
}

export function setOutlineMode(next: OutlineModeChoice): void {
  current = next;
  try {
    window.localStorage.setItem(storageKey, next);
  } catch {
    current = next;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOutlineMode(): [OutlineModeChoice, (next: OutlineModeChoice) => void] {
  const mode = useSyncExternalStore(subscribe, outlineModeNow, () => defaultOutlineModeChoice);
  return [mode, setOutlineMode];
}
