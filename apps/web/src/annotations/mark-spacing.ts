import type { Point } from "./polygon-draft.ts";

const markSpacing = 26;

const crowds = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) < markSpacing && Math.abs(a.y - b.y) < markSpacing;

export function spacedMarks<T extends { readonly at: Point }>(marks: readonly T[]): T[] {
  const kept: T[] = [];
  for (const mark of marks) {
    let at = mark.at;
    while (kept.some((other) => crowds(other.at, at))) at = { x: at.x + markSpacing, y: at.y };
    kept.push(at === mark.at ? mark : { ...mark, at });
  }
  return kept;
}
