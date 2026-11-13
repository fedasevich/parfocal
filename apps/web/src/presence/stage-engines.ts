import { useSyncExternalStore } from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";

const engines = new Map<string, ViewerEngine>();
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of [...listeners]) listener();
};

export function registerStageEngine(slideId: string, engine: ViewerEngine): () => void {
  engines.set(slideId, engine);
  announce();
  return () => {
    if (engines.get(slideId) !== engine) return;
    engines.delete(slideId);
    announce();
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useStageEngine(slideId: string): ViewerEngine | null {
  return useSyncExternalStore(subscribe, () => engines.get(slideId) ?? null);
}
