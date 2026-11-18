export const typerClasses = ["tumor", "stroma", "immune", "other"] as const;

export type TyperClass = (typeof typerClasses)[number];

export type TypedOutlines = {
  slide_id: string;
  typer: string;
  version: string;
  calibrated: boolean;
  outlines: { type: string; foreground: number }[];
};

type Ring = readonly (readonly number[])[];

type CellFeature = { geometry: { type: string; coordinates: readonly Ring[] } };

export type CellCollection = { features: readonly CellFeature[] };

export const typedSlideLabel = "test_065";

export const typedCellsFile = new URL(
  "../../../packages/test-fixtures/model-results/test-065/cells.geojson",
  import.meta.url,
);

export const typerSpan = 512;

export function outlinePoints(ring: Ring): number[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    ring.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1];
  const open = closed ? ring.slice(0, -1) : ring;
  return open.flatMap((point) => [Number(point[0]), Number(point[1])]);
}

function spanOf(points: readonly number[]): number {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export function typeable(points: readonly number[]): boolean {
  return points.length >= 6 && points.length % 2 === 0 && spanOf(points) <= typerSpan;
}

export function firstTypeableCell(cells: CellCollection): number[] | null {
  for (const feature of cells.features) {
    if (feature.geometry.type !== "Polygon") continue;
    const ring = feature.geometry.coordinates[0];
    if (ring === undefined) continue;
    const points = outlinePoints(ring);
    if (typeable(points)) return points;
  }
  return null;
}

export function isTyperClass(value: string): value is TyperClass {
  return (typerClasses as readonly string[]).includes(value);
}

export function typingProblem(answer: TypedOutlines, slideId: string): string | null {
  if (answer.slide_id !== slideId) return `the typer answered for slide ${answer.slide_id}`;
  if (answer.outlines.length !== 1) return `the typer sent ${answer.outlines.length} outlines back`;
  const typed = answer.outlines[0];
  if (typed === undefined || !isTyperClass(typed.type)) {
    return `the typer sent the class ${typed?.type ?? "nothing"}`;
  }
  return null;
}

export const typerWaitMs = 240_000;

export const typerRetryMs = 15_000;

export function retriesTyping(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}
