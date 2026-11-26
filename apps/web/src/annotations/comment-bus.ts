import { useSyncExternalStore } from "react";

export type Reach =
  | { readonly kind: "object"; readonly id: string }
  | { readonly kind: "layer"; readonly key: string };

type Listener<T> = (value: T) => void;

function channel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    send: (value: T) => {
      for (const listener of listeners) listener(value);
    },
    listen: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get: () => value,
    set: (next: T) => {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

const reaches = channel<Reach>();
const layerComments = channel<string>();
const rowThreads = channel<string>();

export const requestRowThread = rowThreads.send;
export const onRowThread = rowThreads.listen;

export const reachMention = reaches.send;
export const onReach = reaches.listen;
export const requestLayerComment = layerComments.send;
export const onLayerComment = layerComments.listen;

export type LayerName = { readonly key: string; readonly name: string };

const noNames: readonly LayerName[] = [];
const names = store<readonly LayerName[]>(noNames);
const noCounts: ReadonlyMap<string, number> = new Map();
const counts = store<ReadonlyMap<string, number>>(noCounts);

const sameNames = (a: readonly LayerName[], b: readonly LayerName[]) =>
  a.length === b.length &&
  a.every((item, index) => item.key === b[index]?.key && item.name === b[index]?.name);

export function publishLayerNames(next: readonly LayerName[]) {
  if (!sameNames(names.get(), next)) names.set(next);
}

export const useLayerNames = names.use;
export const layerNames = names.get;

export function publishThreadCounts(next: ReadonlyMap<string, number>) {
  const before = counts.get();
  const same = before.size === next.size && [...next].every(([key, n]) => before.get(key) === n);
  if (!same) counts.set(next);
}

export const useThreadCounts = counts.use;
