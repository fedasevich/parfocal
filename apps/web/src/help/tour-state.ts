import { useSyncExternalStore } from "react";
import { helpRequests } from "./help-open.ts";

let active: number | null = null;
let helpOpen = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const startTour = (index: number) => {
  active = index;
  helpOpen = false;
  emit();
};

export const stopTour = () => {
  active = null;
  emit();
};

helpRequests.addEventListener("open", () => {
  helpOpen = true;
  emit();
});

export const closeHelp = () => {
  helpOpen = false;
  emit();
};

export const useActiveTourStep = () =>
  useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );

export const useHelpOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => helpOpen,
    () => false,
  );
