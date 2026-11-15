import type { CellShape } from "./slide-geometry.ts";

const circleSegments = 16;

const numbersOf = (path: string) => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

export function ringOfShape(shape: CellShape | undefined): Float32Array | undefined {
  if (shape === undefined) return undefined;
  if (shape.path.includes("A")) {
    const [left, centre, radius] = numbersOf(shape.path);
    if (left === undefined || centre === undefined || radius === undefined) return undefined;
    const middle = left + radius;
    const ring = new Float32Array(circleSegments * 2);
    for (let step = 0; step < circleSegments; step++) {
      const angle = (step / circleSegments) * Math.PI * 2;
      ring[step * 2] = middle + Math.cos(angle) * radius;
      ring[step * 2 + 1] = centre + Math.sin(angle) * radius;
    }
    return ring;
  }
  const values = numbersOf(shape.path);
  if (values.length < 6) return undefined;
  return Float32Array.from(values.length % 2 === 0 ? values : values.slice(0, -1));
}
