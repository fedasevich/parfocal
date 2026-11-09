import type { ReviewObject } from "@parfocal/api-client";
import type { Camera } from "./slide-still.tsx";

const zoomFactors: Record<string, number> = { fit: 1, tight: 1.6, context: 0.6 };

export function zoomedCamera(home: Camera, zoom: string): Camera {
  return { ...home, scale: home.scale * (zoomFactors[zoom] ?? 1) };
}

function hashOf(text: string) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

const byObject = (a: ReviewObject, b: ReviewObject) => a.object.localeCompare(b.object);

const sorters: Record<string, (seed: string) => (a: ReviewObject, b: ReviewObject) => number> = {
  size: () => (a, b) => (b.size_mm ?? -1) - (a.size_mm ?? -1) || byObject(a, b),
  leastsure: () => (a, b) => a.score - b.score || byObject(a, b),
  random: (seed) => (a, b) =>
    hashOf(`${seed}:${a.object}`) - hashOf(`${seed}:${b.object}`) || byObject(a, b),
};

export function orderObjects(
  objects: readonly ReviewObject[],
  order: string,
  seed: string,
): ReviewObject[] {
  const make = sorters[order];
  if (make === undefined) return [...objects];
  const compare = make(seed);
  return [
    ...objects.filter((item) => item.kind === "region").sort(compare),
    ...objects.filter((item) => item.kind === "cell").sort(compare),
  ];
}
