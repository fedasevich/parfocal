export type StageStart = { readonly x: number; readonly y: number; readonly scale: number };

export type StageArea = { x: number; y: number; width: number; height: number };

export function startCamera(
  start: StageStart,
  slide: { width: number; height: number },
  fitZoom: number,
) {
  return {
    x: start.x * slide.width,
    y: start.y * slide.height,
    zoom: fitZoom + Math.log2(Math.max(start.scale, 1)),
  };
}

export function viewportRect(
  camera: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
): [number, number, number, number] {
  const scale = 2 ** camera.zoom;
  const width = size.width / scale;
  const height = size.height / scale;
  return [camera.x - width / 2, camera.y - height / 2, width, height];
}

export function outlineArea(outline: readonly number[] | null | undefined): StageArea | null {
  if (!outline || outline.length < 4) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < outline.length; index += 2) {
    const x = outline[index] ?? 0;
    const y = outline[index + 1] ?? 0;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const side = Math.max(right - left, bottom - top, 1) * 2;
  return {
    x: (left + right) / 2 - side / 2,
    y: (top + bottom) / 2 - side / 2,
    width: side,
    height: side,
  };
}

export function nextOpenObject(
  order: readonly string[],
  decided: ReadonlySet<string>,
  after: string | null,
): string | null {
  const start = after === null ? -1 : order.indexOf(after);
  const rotated = [...order.slice(start + 1), ...order.slice(0, start + 1)];
  return rotated.find((id) => id !== after && !decided.has(id)) ?? null;
}

const engineClasses = ["tumor", "stroma", "immune", "other"] as const;

const engineClassOf = (name: string) =>
  engineClasses.find((item) => item === name.toLowerCase()) ?? "other";

type Placeable = {
  readonly object: string;
  readonly kind?: string;
  readonly class_name: string;
  readonly score: number;
  readonly outline?: number[] | null;
};

export function outlineCentre(
  outline: readonly number[] | null | undefined,
): { x: number; y: number; radius: number } | null {
  const area = outlineArea(outline);
  if (area === null) return null;
  return { x: area.x + area.width / 2, y: area.y + area.height / 2, radius: area.width / 4 };
}

export function slideToScreen(
  point: { x: number; y: number },
  camera: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
) {
  const scale = 2 ** camera.zoom;
  return {
    x: (point.x - camera.x) * scale + size.width / 2,
    y: (point.y - camera.y) * scale + size.height / 2,
  };
}

type SummaryRows = {
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly diagonal: ArrayLike<number>;
  readonly score: ArrayLike<number>;
};

export function summaryCells(setId: string, summary: SummaryRows) {
  const cells = [];
  for (let row = 0; row < summary.count; row += 1) {
    const x = summary.x[row] ?? 0;
    const y = summary.y[row] ?? 0;
    const half = Math.max(1, (summary.diagonal[row] ?? 2) / 2);
    cells.push({
      id: `${setId}:${row}`,
      kind: "cell" as const,
      ring: [x - half, y - half, x + half, y - half, x + half, y + half, x - half, y + half],
      className: "other" as const,
      score: (summary.score[row] ?? 0) / 255,
    });
  }
  return cells;
}

export function placedObjects(objects: readonly Placeable[]) {
  return objects.flatMap((item) =>
    item.outline && item.outline.length >= 6
      ? [
          {
            id: item.object,
            kind: item.kind === "cell" ? ("cell" as const) : ("region" as const),
            ring: item.outline,
            className: engineClassOf(item.class_name),
            score: item.score,
          },
        ]
      : [],
  );
}
