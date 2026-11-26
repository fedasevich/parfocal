import { sameObjectId } from "@parfocal/ui/lib/object-id";
import { useSyncExternalStore } from "react";
import type { SlideAreaEntry } from "../viewer/slide-areas.ts";
import type { Point } from "./polygon-draft.ts";
import type { Extent } from "./shapes.ts";

export type ResultObject = { readonly id: string; readonly ring: readonly number[] };

function keyed<T>(empty: T, same: (a: T, b: T) => boolean) {
  const values = new Map<string, T>();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const get = (key: string) => values.get(key) ?? empty;
  return {
    get,
    set: (key: string, next: T) => {
      if (same(get(key), next)) return;
      if (same(empty, next)) values.delete(key);
      else values.set(key, next);
      for (const listener of listeners) listener();
    },
    use: (key: string) => useSyncExternalStore(subscribe, () => get(key)),
  };
}

const noObjects: readonly ResultObject[] = [];

const sameObjects = (a: readonly ResultObject[], b: readonly ResultObject[]) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return other !== undefined && item.id === other.id && item.ring.length === other.ring.length;
  });

const objects = keyed<readonly ResultObject[]>(noObjects, sameObjects);
const current = keyed<string | null>(null, (a, b) => a === b);

export const publishResultObjects = (slideId: string, next: readonly ResultObject[]) =>
  objects.set(slideId, next);
export const useResultObjects = objects.use;
export const resultObjectsOf = objects.get;

export const publishCurrentResult = (slideId: string, id: string | null) =>
  current.set(slideId, id);
export const useCurrentResult = current.use;

export function ringExtent(ring: readonly number[]): Extent | null {
  if (ring.length < 2) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < ring.length; index += 2) {
    const x = ring[index] ?? 0;
    const y = ring[index + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function inside(ring: readonly number[], at: Point): boolean {
  let hit = false;
  const count = Math.floor(ring.length / 2);
  for (let index = 0, back = count - 1; index < count; back = index, index += 1) {
    const ax = ring[index * 2] ?? 0;
    const ay = ring[index * 2 + 1] ?? 0;
    const bx = ring[back * 2] ?? 0;
    const by = ring[back * 2 + 1] ?? 0;
    if (ay > at.y !== by > at.y && at.x < ((bx - ax) * (at.y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

const areaOf = ([minX, minY, maxX, maxY]: Extent) => (maxX - minX) * (maxY - minY);

export function resultAt(
  list: readonly ResultObject[],
  at: Point,
  reach: number,
): ResultObject | null {
  let best: ResultObject | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const item of list) {
    const extent = ringExtent(item.ring);
    if (extent === null) continue;
    const [minX, minY, maxX, maxY] = extent;
    const near =
      at.x >= minX - reach && at.x <= maxX + reach && at.y >= minY - reach && at.y <= maxY + reach;
    if (!near) continue;
    const small = Math.max(maxX - minX, maxY - minY) <= reach * 2;
    if (!small && (item.ring.length < 6 || !inside(item.ring, at))) continue;
    const area = areaOf(extent);
    if (area < bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return best;
}

export const findResult = (list: readonly ResultObject[], id: string) =>
  list.find((item) => sameObjectId(item.id, id));

export function resultFor(
  list: readonly ResultObject[],
  areas: readonly SlideAreaEntry[],
  id: string,
): ResultObject | undefined {
  const found = findResult(list, id);
  if (found !== undefined) return found;
  const area = areas.find((entry) => sameObjectId(entry.object, id));
  if (area === undefined) return undefined;
  const { x, y, width, height } = area.bounds;
  return { id: area.object, ring: [x, y, x + width, y, x + width, y + height, x, y + height] };
}
