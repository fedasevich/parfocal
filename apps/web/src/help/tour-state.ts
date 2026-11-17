import { useSyncExternalStore } from "react";

let active: number | null = null;
let helpOpen = false;
let offerShown = false;
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

window.addEventListener("help", () => {
  helpOpen = true;
  emit();
});

export const closeHelp = () => {
  helpOpen = false;
  emit();
};

let offerSlot: HTMLElement | null = null;

export const setTourOfferSlot = (slot: HTMLElement | null) => {
  if (offerSlot === slot) return;
  offerSlot = slot;
  emit();
};

export const useTourOfferSlot = () =>
  useSyncExternalStore(
    subscribe,
    () => offerSlot,
    () => null,
  );

export const setTourOfferShown = (shown: boolean) => {
  if (offerShown === shown) return;
  offerShown = shown;
  emit();
};

export const useTourCornerBusy = () =>
  useSyncExternalStore(
    subscribe,
    () => offerShown || active !== null,
    () => false,
  );

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
