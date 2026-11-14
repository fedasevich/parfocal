import { useSyncExternalStore } from "react";
import type { ShownCursor, SlideShare } from "./shared-cursor.ts";

type PointerListener = (at: SlideShare | null) => void;

const shown = new Map<string, ShownCursor>();
const shownListeners = new Set<() => void>();
const pointerListeners = new Map<string, Set<PointerListener>>();

export function showCursor(slideId: string, cursor: ShownCursor | null): void {
  if (cursor === null && !shown.has(slideId)) return;
  if (cursor === null) shown.delete(slideId);
  else shown.set(slideId, cursor);
  for (const listener of [...shownListeners]) listener();
}

const subscribeShown = (listener: () => void) => {
  shownListeners.add(listener);
  return () => shownListeners.delete(listener);
};

export function useShownCursor(slideId: string): ShownCursor | null {
  return useSyncExternalStore(subscribeShown, () => shown.get(slideId) ?? null);
}

export function reportPointer(slideId: string, at: SlideShare | null): void {
  for (const listener of [...(pointerListeners.get(slideId) ?? [])]) listener(at);
}

export function onPointer(slideId: string, listener: PointerListener): () => void {
  const listeners = pointerListeners.get(slideId) ?? new Set<PointerListener>();
  pointerListeners.set(slideId, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) pointerListeners.delete(slideId);
  };
}
