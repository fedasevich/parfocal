import { useSyncExternalStore } from "react";
import type { ShownCursor, SlideShare } from "./shared-cursor.ts";

type PointerListener = (at: SlideShare | null) => void;

const nothingShown: readonly ShownCursor[] = [];
const shown = new Map<string, readonly ShownCursor[]>();
const shownListeners = new Set<() => void>();
const pointerListeners = new Map<string, Set<PointerListener>>();

export function showCursors(slideId: string, cursors: readonly ShownCursor[]): void {
  if (cursors.length === 0 && !shown.has(slideId)) return;
  if (cursors.length === 0) shown.delete(slideId);
  else shown.set(slideId, cursors);
  for (const listener of [...shownListeners]) listener();
}

const subscribeShown = (listener: () => void) => {
  shownListeners.add(listener);
  return () => shownListeners.delete(listener);
};

export function shownCursors(slideId: string): readonly ShownCursor[] {
  return shown.get(slideId) ?? nothingShown;
}

export function useShownCursors(slideId: string): readonly ShownCursor[] {
  return useSyncExternalStore(subscribeShown, () => shownCursors(slideId));
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
