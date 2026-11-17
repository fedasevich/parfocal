import type { Checklist } from "@parfocal/api-client";
import { useMemo, useSyncExternalStore } from "react";
import {
  checklistHintId,
  checklistHintPrefix,
  noteHintsSeen,
  readGuestHints,
  useHintsSeen,
} from "../../hints/hints-seen.ts";
import { destinations } from "../../shell/destinations.ts";

export type Step = Checklist["steps"][number];
export type StepKey = Step["key"];

export type TriedStore = {
  mark: (key: StepKey) => void;
  snapshot: () => ReadonlySet<StepKey>;
  subscribe: (listener: () => void) => () => void;
};

const stepKeyOf = (id: string): StepKey | undefined =>
  id.startsWith(checklistHintPrefix)
    ? (id.slice(checklistHintPrefix.length) as StepKey)
    : undefined;

const triedFrom = (ids: Iterable<string>): StepKey[] =>
  [...ids].flatMap((id) => stepKeyOf(id) ?? []);

const savedTried = (): StepKey[] => triedFrom(readGuestHints());

const saveTried = (tried: ReadonlySet<StepKey>) => noteHintsSeen([...tried].map(checklistHintId));

export function createTriedStore(
  initial: readonly StepKey[] = [],
  onChange: (tried: ReadonlySet<StepKey>) => void = () => undefined,
): TriedStore {
  let tried: ReadonlySet<StepKey> = new Set(initial);
  const listeners = new Set<() => void>();
  return {
    mark(key) {
      if (tried.has(key)) return;
      tried = new Set([...tried, key]);
      onChange(tried);
      for (const listener of listeners) listener();
    },
    snapshot: () => tried,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const triedStore = createTriedStore(savedTried(), saveTried);

export const markTried = (key: StepKey) => triedStore.mark(key);

export function useTried(store: TriedStore = triedStore): ReadonlySet<StepKey> {
  const local = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const { seen } = useHintsSeen();
  return useMemo(() => new Set([...local, ...triedFrom(seen)]), [local, seen]);
}

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
