import type { Checklist } from "@parfocal/api-client";
import { useSyncExternalStore } from "react";
import { destinations } from "../../shell/destinations.ts";

export type Step = Checklist["steps"][number];
export type StepKey = Step["key"];

export type TriedStore = {
  mark: (key: StepKey) => void;
  snapshot: () => ReadonlySet<StepKey>;
  subscribe: (listener: () => void) => () => void;
};

export function createTriedStore(): TriedStore {
  let tried: ReadonlySet<StepKey> = new Set();
  const listeners = new Set<() => void>();
  return {
    mark(key) {
      if (tried.has(key)) return;
      tried = new Set([...tried, key]);
      for (const listener of listeners) listener();
    },
    snapshot: () => tried,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const triedStore = createTriedStore();

export const markTried = (key: StepKey) => triedStore.mark(key);

export const useTried = (store: TriedStore = triedStore) =>
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);

export const stepsWithTried = (steps: Step[], tried: ReadonlySet<StepKey>): Step[] =>
  steps.map((step) => (step.done || !tried.has(step.key) ? step : { ...step, done: true }));

export const checklistShows = (input: {
  serverHidden: boolean;
  personalHidden: boolean;
  steps: Step[];
}): boolean =>
  !input.serverHidden &&
  !input.personalHidden &&
  input.steps.length > 0 &&
  input.steps.some((step) => !step.done);

export const stepTarget = (key: StepKey): string | undefined =>
  key === "guided-review" || key === "comment" || key === "opinion"
    ? destinations.guided("sample")
    : undefined;
