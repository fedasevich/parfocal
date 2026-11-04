import type { CameraSearch } from "./camera-search.ts";

export function stepSlideId(ids: readonly string[], currentId: string, delta: 1 | -1) {
  const at = ids.indexOf(currentId);
  if (at < 0) return undefined;
  return ids[at + delta];
}

const storageKey = "parfocal.slide-cameras";
const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
const maxSlidesPerUser = 200;

type Entry = { x: number; y: number; z: number; at: number };
type Store = Record<string, Record<string, Entry>>;

function isEntry(value: unknown): value is Entry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return ["x", "y", "z", "at"].every((key) => Number.isFinite(entry[key]));
}

function readStore(): Store {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (parsed === null || typeof parsed !== "object") return {};
    const store: Store = {};
    for (const [user, slides] of Object.entries(parsed)) {
      if (slides === null || typeof slides !== "object") continue;
      const slideEntries: [string, Entry][] = [];
      for (const [id, entry] of Object.entries(slides as Record<string, unknown>))
        if (isEntry(entry)) slideEntries.push([id, entry]);
      store[user] = Object.fromEntries(slideEntries);
    }
    return store;
  } catch {
    return {};
  }
}

function fresh(slides: Record<string, Entry>, now: number) {
  return Object.entries(slides).filter(([, entry]) => now - entry.at <= maxAgeMs);
}

export function rememberSlideCamera(
  userId: string | undefined,
  slideId: string,
  search: CameraSearch,
  now = Date.now(),
) {
  if (userId === undefined) return;
  if (search.x === undefined || search.y === undefined || search.z === undefined) return;
  const store = readStore();
  const kept = fresh(store[userId] ?? {}, now).filter(([id]) => id !== slideId);
  kept.push([slideId, { x: search.x, y: search.y, z: search.z, at: now }]);
  kept.sort((a, b) => a[1].at - b[1].at);
  store[userId] = Object.fromEntries(kept.slice(-maxSlidesPerUser));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    return;
  }
}

export function recallSlideCamera(
  userId: string | undefined,
  slideId: string,
  now = Date.now(),
): CameraSearch {
  if (userId === undefined) return {};
  const entry = readStore()[userId]?.[slideId];
  if (entry === undefined || now - entry.at > maxAgeMs) return {};
  return { x: entry.x, y: entry.y, z: entry.z };
}
