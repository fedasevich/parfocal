import { useSyncExternalStore } from "react";
import { tourMenuEvent } from "./tour-menu-event.ts";
import { firstStepOf, type TourRole, tourRoles, tourSteps } from "./tour-steps.ts";

export type TourState = {
  index: number;
  playAll: boolean;
  acting: TourRole;
};

const storageKey = "parfocal.app-tour";

const listeners = new Set<() => void>();
let menuOpen = false;

const isRole = (value: unknown): value is TourRole =>
  typeof value === "string" && (tourRoles as readonly string[]).includes(value);

export type TourMove = "moved" | "ended";

function read(): TourState | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const { index, playAll, acting } = parsed as Record<string, unknown>;
    if (typeof index !== "number" || tourSteps[index] === undefined) return null;
    return { index, playAll: playAll === true, acting: isRole(acting) ? acting : "owner" };
  } catch {
    return null;
  }
}

let current: TourState | null = read();

const emit = () => {
  for (const listener of listeners) listener();
};

function write(next: TourState | null) {
  current = next;
  if (next === null) window.localStorage.removeItem(storageKey);
  else window.localStorage.setItem(storageKey, JSON.stringify(next));
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

window.addEventListener("storage", (event) => {
  if (event.key !== storageKey) return;
  current = read();
  emit();
});

window.addEventListener(tourMenuEvent, () => {
  menuOpen = true;
  emit();
});

export const closeTourMenu = () => {
  menuOpen = false;
  emit();
};

export const useTourState = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

export const useTourMenuOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => menuOpen,
    () => false,
  );

export const tourState = () => current;

export function playChapter(chapter: number, playAll: boolean) {
  const index = firstStepOf(chapter);
  if (index < 0) return;
  menuOpen = false;
  write({ index, playAll, acting: current?.acting ?? "owner" });
}

export function goToStep(index: number): TourMove {
  if (current === null) return "ended";
  const step = tourSteps[index];
  const leaving = tourSteps[current.index];
  if (step === undefined || (!current.playAll && step.chapter !== leaving?.chapter)) {
    write(null);
    return "ended";
  }
  write({ ...current, index });
  return "moved";
}

export function skipChapter(): TourMove {
  if (current === null) return "ended";
  const next = firstStepOf((tourSteps[current.index]?.chapter ?? 0) + 1);
  if (next < 0 || !current.playAll) {
    write(null);
    return "ended";
  }
  write({ ...current, index: next });
  return "moved";
}

export const setActing = (acting: TourRole) => {
  if (current !== null) write({ ...current, acting });
};

export const endTour = () => write(null);
