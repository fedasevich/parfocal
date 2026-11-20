import { useSyncExternalStore } from "react";
import { developerSectionKeys } from "../screens/developer/developer-keys.ts";
import { setDeveloperMode } from "../shell/developer-mode.ts";

export type DrawerSection = (typeof developerSectionKeys)[number];

export type DeveloperDrawerState = { open: boolean; section: DrawerSection };

const storageKey = "parfocal-developer-drawer";

const closed: DeveloperDrawerState = { open: false, section: "renderer" };

const listeners = new Set<() => void>();

let current: DeveloperDrawerState | null = null;

const isSection = (value: unknown): value is DrawerSection =>
  developerSectionKeys.some((key) => key === value);

function stored(): DeveloperDrawerState {
  try {
    const section = window.sessionStorage.getItem(storageKey);
    return isSection(section) ? { open: true, section } : closed;
  } catch {
    return closed;
  }
}

export function readDeveloperDrawer(): DeveloperDrawerState {
  current ??= stored();
  return current;
}

function publish(next: DeveloperDrawerState): void {
  current = next;
  try {
    if (next.open) window.sessionStorage.setItem(storageKey, next.section);
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    current = next;
  }
  for (const notify of listeners) notify();
}

export function openDeveloperDrawer(section?: string): void {
  setDeveloperMode(true);
  publish({ open: true, section: isSection(section) ? section : readDeveloperDrawer().section });
}

export function closeDeveloperDrawer(): void {
  publish({ ...readDeveloperDrawer(), open: false });
}

export function toggleDeveloperDrawer(): void {
  if (readDeveloperDrawer().open) closeDeveloperDrawer();
  else openDeveloperDrawer();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useDeveloperDrawer(): DeveloperDrawerState {
  return useSyncExternalStore(subscribe, readDeveloperDrawer, () => closed);
}

const slidePath = /^\/projects\/[^/]+\/slides\/[^/]+/;

export const isSlidePath = (pathname: string): boolean => slidePath.test(pathname);
