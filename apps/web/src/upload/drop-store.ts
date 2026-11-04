import { useSyncExternalStore } from "react";
import type { DroppedItem } from "./drop.ts";
import type { FileIdentity } from "./entries.ts";

export type DropSnapshot = {
  projectId: string | null;
  items: readonly DroppedItem[];
  started: readonly FileIdentity[];
};

const empty: DropSnapshot = { projectId: null, items: [], started: [] };

let snapshot: DropSnapshot = empty;
const listeners = new Set<() => void>();

function publish(next: DropSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export const dropStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => snapshot,
  add: (projectId: string, items: readonly DroppedItem[]) => {
    const base = snapshot.projectId === projectId ? snapshot : { ...empty, projectId };
    const known = new Set(base.items.map((item) => `${item.path}:${item.size}`));
    const fresh = items.filter((item) => !known.has(`${item.path}:${item.size}`));
    publish({ ...base, items: [...base.items, ...fresh] });
  },
  begin: (projectId: string): void => {
    if (snapshot.projectId !== projectId) publish({ ...empty, projectId });
  },
  markStarted: (started: readonly FileIdentity[]) => {
    publish({ ...snapshot, started });
  },
  clear: () => {
    publish(empty);
  },
};

export function useDropStore(): DropSnapshot {
  return useSyncExternalStore(dropStore.subscribe, dropStore.get);
}
