import { useSyncExternalStore } from "react";
import type { Reach } from "./comment-bus.ts";

export type Reference = {
  readonly id: string;
  readonly text: string;
  readonly sub: string;
  readonly reach: Reach;
};

const sources = new Map<string, readonly Reference[]>();
const noReferences: readonly Reference[] = [];
let all: readonly Reference[] = noReferences;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const same = (a: readonly Reference[], b: readonly Reference[]) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.id === other.id &&
      item.text === other.text &&
      item.sub === other.sub
    );
  });

export function publishReferences(source: string, next: readonly Reference[]) {
  if (same(sources.get(source) ?? noReferences, next)) return;
  if (next.length === 0) sources.delete(source);
  else sources.set(source, next);
  const seen = new Set<string>();
  all = [...sources.values()].flat().filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
  for (const listener of listeners) listener();
}

export const useReferenceList = () => useSyncExternalStore(subscribe, () => all);
export const referenceList = () => all;

export const referenceQuery = (text: string) => text.match(/(^|\s)#([^\s#]{0,40})$/)?.[2];

export const withReference = (text: string, reference: Pick<Reference, "text">) =>
  text.replace(/#[^\s#]{0,40}$/, `${reference.text} `);

export const anchorReferenceName = (kind: "Region" | "Selection", index: number) =>
  `#${kind} ${index + 1}`;
