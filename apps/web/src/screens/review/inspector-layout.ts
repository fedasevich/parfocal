import { useCallback, useSyncExternalStore } from "react";

export const inspectorDefaultWidth = 340;
export const inspectorMinWidth = 280;
export const inspectorMaxWidth = 560;
export const inspectorHideBelow = 220;

export type InspectorLayout = { width: number; hidden: boolean; hideWhilePanning: boolean };

export const defaultInspectorLayout: InspectorLayout = {
  width: inspectorDefaultWidth,
  hidden: false,
  hideWhilePanning: false,
};

const storageKey = "parfocal.inspector-panel";
const changeEvent = "parfocal:inspector-panel";
const guestKey = "guest";

export function clampInspectorWidth(width: number): number {
  return Math.min(inspectorMaxWidth, Math.max(inspectorMinWidth, Math.round(width)));
}

export function dragInspector(width: number): { width: number; hidden: boolean } {
  if (width < inspectorHideBelow) return { width: inspectorMinWidth, hidden: true };
  return { width: clampInspectorWidth(width), hidden: false };
}

function sanitised(value: unknown): InspectorLayout {
  if (value === null || typeof value !== "object") return defaultInspectorLayout;
  const entry = value as Record<string, unknown>;
  const width = entry["width"];
  return {
    width:
      typeof width === "number" && Number.isFinite(width)
        ? clampInspectorWidth(width)
        : inspectorDefaultWidth,
    hidden: entry["hidden"] === true,
    hideWhilePanning: entry["hideWhilePanning"] === true,
  };
}

function readStore(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readInspectorLayout(userId: string | undefined): InspectorLayout {
  return sanitised(readStore()[userId ?? guestKey]);
}

export function writeInspectorLayout(userId: string | undefined, layout: InspectorLayout) {
  const store = readStore();
  store[userId ?? guestKey] = layout;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const snapshots = new Map<string, InspectorLayout>();

function snapshot(userId: string | undefined): InspectorLayout {
  const next = readInspectorLayout(userId);
  const key = `${userId ?? guestKey}|${JSON.stringify(next)}`;
  const known = snapshots.get(key);
  if (known) return known;
  snapshots.set(key, next);
  return next;
}

export function useInspectorLayout(
  userId: string | undefined,
): [InspectorLayout, (patch: Partial<InspectorLayout>) => void] {
  const layout = useSyncExternalStore(
    subscribe,
    () => snapshot(userId),
    () => defaultInspectorLayout,
  );
  const update = useCallback(
    (patch: Partial<InspectorLayout>) =>
      writeInspectorLayout(userId, { ...readInspectorLayout(userId), ...patch }),
    [userId],
  );
  return [layout, update];
}
