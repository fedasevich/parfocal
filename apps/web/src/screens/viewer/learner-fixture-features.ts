import { cellShapes } from "../review/slide-geometry.ts";
import { type LearnerCell, learnerClassKeys } from "./slide-learner.ts";

const dims = 8;

function hashOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function noiseOf(seed: number, index: number): number {
  const mixed = Math.imul(seed ^ Math.imul(index + 1, 2654435761), 1597334677) >>> 0;
  return mixed / 4294967295 - 0.5;
}

export function fixtureTruth(object: string): string | null {
  if (cellShapes[object] === undefined) return null;
  return learnerClassKeys[hashOf(object) % learnerClassKeys.length] ?? null;
}

export function fixturePooledFeature(cell: LearnerCell): Float32Array | null {
  const truth = fixtureTruth(cell.object);
  if (truth === null) return null;
  const seed = hashOf(cell.object);
  const label = learnerClassKeys.indexOf(truth);
  return Float32Array.from(
    { length: dims },
    (_, index) => (index === label ? 3 : 0) + noiseOf(seed, index) * 0.6,
  );
}
