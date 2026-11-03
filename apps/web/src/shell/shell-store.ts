import { useSyncExternalStore } from "react";

export type ShellState = {
  initialsOnly: boolean;
};

const initial: ShellState = { initialsOnly: false };

let state: ShellState = initial;
const listeners = new Set<() => void>();

export const shellStore = {
  getState: (): ShellState => state,
  setState: (patch: Partial<ShellState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  reset: (): void => {
    state = initial;
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useShell<T>(select: (state: ShellState) => T): T {
  return useSyncExternalStore(
    shellStore.subscribe,
    () => select(state),
    () => select(initial),
  );
}
