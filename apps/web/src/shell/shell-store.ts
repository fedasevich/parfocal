import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type ShellState = {
  initialsOnly: boolean;
  navOpen: boolean;
};

const initial: ShellState = { initialsOnly: false, navOpen: false };

const store = createStore<ShellState>(() => initial);

export const shellStore = {
  getState: store.getState,
  setState: (patch: Partial<ShellState>): void => store.setState(patch),
  reset: (): void => store.setState(initial, true),
  subscribe: (listener: () => void): (() => void) => store.subscribe(() => listener()),
};

export function useShell<T>(select: (state: ShellState) => T): T {
  return useStore(store, select);
}
